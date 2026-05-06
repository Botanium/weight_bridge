import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import getseries
from frappe.utils import cstr, flt, get_datetime, now_datetime


FINAL_DIRECTIONS = {"IN", "OUT"}
PARTY_LINK_TYPES = {"Supplier", "Customer", "Warehouse"}
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

	def autoname(self):
		self._set_calculated_fields()
		if self._has_complete_weights():
			self.name = self._make_final_name()
		else:
			self.name = self._make_series_name("WB")

	def validate(self):
		self._validate_first_weight()
		self._validate_second_weight()
		self._validate_dynamic_link_types()
		self._validate_cargo_item()
		self._set_calculated_fields()
		self._protect_finalized_fields()

	def on_update(self):
		if getattr(frappe.flags, "weight_bridge_ticket_renaming", False):
			return
		if not self._has_complete_weights() or not self.name.startswith("WB-"):
			return

		new_name = self._make_final_name()
		frappe.flags.weight_bridge_ticket_renaming = True
		try:
			frappe.rename_doc(
				self.doctype,
				self.name,
				new_name,
				force=True,
				merge=False,
				show_alert=False,
			)
			self.name = new_name
		finally:
			frappe.flags.weight_bridge_ticket_renaming = False

	def _validate_first_weight(self):
		if flt(self.first_weight) <= 0:
			frappe.throw(_("First Weight must be greater than zero."))

	def _validate_second_weight(self):
		if not self._has_second_weight():
			return

		if flt(self.second_weight) <= 0:
			frappe.throw(_("Second Weight must be greater than zero."))
		if flt(self.first_weight) == flt(self.second_weight):
			frappe.throw(_("First Weight and Second Weight cannot be equal."))

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
