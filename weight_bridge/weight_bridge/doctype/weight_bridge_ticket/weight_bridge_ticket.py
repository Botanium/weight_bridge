import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import getseries
from frappe.utils import cint, cstr, flt, get_datetime, now_datetime

from weight_bridge.install import WEIGHT_BRIDGE_SETTINGS_DEFAULTS


FINAL_DIRECTIONS = {"IN", "OUT"}
PARTY_LINK_TYPES = {"Supplier", "Customer", "Warehouse"}
DRIVER_FETCH_FIELDS = ("driver_name", "passport_number", "national_code")
ORDER_CLOSED_STATUSES = {"Cancelled", "Closed"}
PROTECTED_FINAL_FIELDS = (
	"first_weight_datetime",
	"second_weight_datetime",
	"first_weight",
	"second_weight",
)


class WeightBridgeTicket(Document):
	def before_validate(self):
		if not self.operator:
			self.operator = frappe.session.user
		if not self.first_weight_datetime:
			self.first_weight_datetime = now_datetime()
		self._set_driver_details()
		self._set_calculated_fields()
		self._set_relevant_order_reference()

	def autoname(self):
		self._set_calculated_fields()
		if self._has_complete_weights():
			self.name = self._make_final_name()
		else:
			self.name = self._make_series_name("WB")

	def validate(self):
		self._validate_first_weight()
		self._validate_second_weight()
		self._validate_truck()
		self._validate_driver()
		self._validate_dynamic_link_types()
		self._validate_cargo_item()
		self._set_calculated_fields()
		self._set_relevant_order_reference()
		self._validate_order_references()
		self._protect_finalized_fields()

	def on_update(self):
		if getattr(frappe.flags, "weight_bridge_ticket_renaming", False):
			return
		if not self._has_complete_weights() or not self.name.startswith("WB-"):
			return

		old_name = self.name
		new_name = self._make_final_name()
		frappe.flags.weight_bridge_ticket_renaming = True
		try:
			frappe.rename_doc(
				self.doctype,
				old_name,
				new_name,
				force=True,
				merge=False,
				show_alert=False,
			)
			self.name = new_name
			self.localname = old_name
		finally:
			frappe.flags.weight_bridge_ticket_renaming = False

	def _validate_first_weight(self):
		settings = self._settings()
		first_weight = flt(self.first_weight)
		min_first_weight = flt(settings.min_first_weight_kg)

		if first_weight <= 0:
			frappe.throw(_("First Weight must be greater than zero."))
		if min_first_weight and first_weight < min_first_weight:
			frappe.throw(_("First Weight must be at least {0} Kg.").format(min_first_weight))

	def _validate_second_weight(self):
		if not self._has_second_weight():
			return

		settings = self._settings()
		second_weight = flt(self.second_weight)
		min_second_weight = flt(settings.min_second_weight_kg)

		if second_weight <= 0:
			frappe.throw(_("Second Weight must be greater than zero."))
		if min_second_weight and second_weight < min_second_weight:
			frappe.throw(_("Second Weight must be at least {0} Kg.").format(min_second_weight))
		if flt(self.first_weight) == flt(self.second_weight):
			frappe.throw(_("First Weight and Second Weight cannot be equal."))
		if (
			cint(settings.require_second_weight_after_first)
			and self.first_weight_datetime
			and self.second_weight_datetime
			and get_datetime(self.second_weight_datetime) < get_datetime(self.first_weight_datetime)
		):
			frappe.throw(_("Second Weight Date and Time cannot be before First Weight Date and Time."))

	def _validate_truck(self):
		if not self.plate_number:
			return

		if not frappe.db.exists("Weight Bridge Truck", self.plate_number):
			frappe.throw(_("Truck Plate Number {0} does not exist.").format(frappe.bold(self.plate_number)))

	def _validate_driver(self):
		if not self.driver:
			return

		if not frappe.db.exists("Weight Bridge Driver", self.driver):
			frappe.throw(_("Driver Phone Number {0} does not exist.").format(frappe.bold(self.driver)))

	def _validate_dynamic_link_types(self):
		for fieldname in ("origin_type", "destination_type"):
			if self.get(fieldname) not in PARTY_LINK_TYPES:
				frappe.throw(_("{0} must be Supplier, Customer, or Warehouse.").format(self.meta.get_label(fieldname)))

	def _validate_cargo_item(self):
		if not self.cargo_item:
			return

		if not frappe.db.exists("Item", self.cargo_item):
			frappe.throw(_("Cargo Item {0} does not exist.").format(frappe.bold(self.cargo_item)))
		if frappe.db.get_value("Item", self.cargo_item, "disabled"):
			frappe.throw(_("Cargo Item {0} is disabled.").format(frappe.bold(self.cargo_item)))

	def _set_relevant_order_reference(self):
		if self.direction == "IN":
			self.sales_order = None
		elif self.direction == "OUT":
			self.purchase_order = None

	def _validate_order_references(self):
		settings = self._settings()
		if self.direction == "IN":
			if cint(settings.require_purchase_order_for_in) and not self.purchase_order:
				frappe.throw(_("Purchase Order is required for IN Weight Bridge Tickets."))
			if self.purchase_order:
				self._validate_purchase_order()
		elif self.direction == "OUT":
			if cint(settings.require_sales_order_for_out) and not self.sales_order:
				frappe.throw(_("Sales Order is required for OUT Weight Bridge Tickets."))
			if self.sales_order:
				self._validate_sales_order()

	def _validate_purchase_order(self):
		purchase_order = frappe.db.get_value(
			"Purchase Order",
			self.purchase_order,
			("docstatus", "status", "supplier"),
			as_dict=True,
		)
		if not purchase_order:
			frappe.throw(_("Purchase Order {0} does not exist.").format(frappe.bold(self.purchase_order)))
		if purchase_order.docstatus != 1:
			frappe.throw(_("Purchase Order {0} must be submitted.").format(frappe.bold(self.purchase_order)))
		if purchase_order.status in ORDER_CLOSED_STATUSES:
			frappe.throw(_("Purchase Order {0} is {1}.").format(frappe.bold(self.purchase_order), purchase_order.status))
		if self.origin_type == "Supplier" and purchase_order.supplier != self.origin:
			frappe.throw(
				_("Purchase Order {0} is for Supplier {1}, not Origin {2}.").format(
					frappe.bold(self.purchase_order),
					frappe.bold(purchase_order.supplier),
					frappe.bold(self.origin),
				)
			)

	def _validate_sales_order(self):
		sales_order = frappe.db.get_value(
			"Sales Order",
			self.sales_order,
			("docstatus", "status", "customer"),
			as_dict=True,
		)
		if not sales_order:
			frappe.throw(_("Sales Order {0} does not exist.").format(frappe.bold(self.sales_order)))
		if sales_order.docstatus != 1:
			frappe.throw(_("Sales Order {0} must be submitted.").format(frappe.bold(self.sales_order)))
		if sales_order.status in ORDER_CLOSED_STATUSES:
			frappe.throw(_("Sales Order {0} is {1}.").format(frappe.bold(self.sales_order), sales_order.status))
		if self.destination_type == "Customer" and sales_order.customer != self.destination:
			frappe.throw(
				_("Sales Order {0} is for Customer {1}, not Destination {2}.").format(
					frappe.bold(self.sales_order),
					frappe.bold(sales_order.customer),
					frappe.bold(self.destination),
				)
			)

	def _set_driver_details(self):
		if not self.driver:
			self.driver_name = None
			self.driver_passport_number = None
			self.driver_national_code = None
			return

		driver = frappe.db.get_value("Weight Bridge Driver", self.driver, DRIVER_FETCH_FIELDS, as_dict=True)
		if not driver:
			return

		self.driver_name = driver.driver_name
		self.driver_passport_number = driver.passport_number
		self.driver_national_code = driver.national_code

	def _set_calculated_fields(self):
		if not self._has_complete_weights():
			self.direction = None
			self.gross_weight = 0
			self.vehicle_weight = 0
			self.net_weight = 0
			self.ticket_status = "Pending Second Weight"
			return

		first_weight = flt(self.first_weight)
		second_weight = flt(self.second_weight)
		if first_weight > second_weight:
			self.direction = "IN"
			self.gross_weight = first_weight
			self.vehicle_weight = second_weight
		else:
			self.direction = "OUT"
			self.gross_weight = second_weight
			self.vehicle_weight = first_weight

		self.net_weight = self.gross_weight - self.vehicle_weight
		self.ticket_status = "Finalized"
		self._validate_calculated_weights()

	def _validate_calculated_weights(self):
		if not self._has_complete_weights():
			return

		settings = self._settings()
		min_net_weight = flt(settings.min_net_weight_kg)
		max_gross_weight = flt(settings.max_gross_weight_kg)
		max_net_weight = flt(settings.max_net_weight_kg)

		if min_net_weight and flt(self.net_weight) < min_net_weight:
			frappe.throw(_("Net Weight must be at least {0} Kg.").format(min_net_weight))
		if max_gross_weight and flt(self.gross_weight) > max_gross_weight:
			frappe.throw(_("Gross Weight cannot be greater than {0} Kg.").format(max_gross_weight))
		if max_net_weight and flt(self.net_weight) > max_net_weight:
			frappe.throw(_("Net Weight cannot be greater than {0} Kg.").format(max_net_weight))

	def _protect_finalized_fields(self):
		if self.is_new() or self.name.startswith("WB-"):
			return

		before_save = self.get_doc_before_save()
		if not before_save or before_save.name.startswith("WB-"):
			return

		for fieldname in PROTECTED_FINAL_FIELDS:
			if self._normalized_field_value(fieldname) != self._normalized_field_value(fieldname, before_save):
				frappe.throw(
					_("{0} cannot be changed after the ticket has a final IN/OUT ID.").format(
						self.meta.get_label(fieldname)
					)
				)

	def _has_complete_weights(self):
		return self._has_second_weight() and flt(self.first_weight) > 0 and flt(self.second_weight) > 0

	def _has_second_weight(self):
		return self.second_weight not in (None, "")

	def _make_final_name(self):
		if self.direction not in FINAL_DIRECTIONS:
			self._set_calculated_fields()

		return self._make_series_name(self.direction)

	def _make_series_name(self, prefix):
		series_prefix = f"{prefix}-{self._ticket_date_part()}-"
		for _ in range(5):
			name = f"{series_prefix}{getseries(series_prefix, 2)}"
			if not frappe.db.exists(self.doctype, name):
				return name

		frappe.throw(_("Could not generate a unique Weight Bridge Ticket ID. Please try again."))

	def _ticket_date_part(self):
		return get_datetime(self.first_weight_datetime).strftime("%y%m%d")

	def _normalized_field_value(self, fieldname, doc=None):
		doc = doc or self
		value = doc.get(fieldname)
		if fieldname.endswith("_weight"):
			return flt(value, 3)
		if fieldname.endswith("_datetime"):
			return cstr(get_datetime(value)) if value else ""
		return cstr(value)

	def _settings(self):
		return get_weight_bridge_settings()


def get_weight_bridge_settings():
	settings = frappe._dict(WEIGHT_BRIDGE_SETTINGS_DEFAULTS.copy())
	if not frappe.db.exists("DocType", "Weight Bridge Settings"):
		return settings

	for fieldname in settings:
		value = frappe.db.get_single_value("Weight Bridge Settings", fieldname)
		if value not in (None, ""):
			settings[fieldname] = value

	return settings
