import frappe
from frappe.tests.utils import FrappeTestCase

from weight_bridge.install import WEIGHT_BRIDGE_SETTINGS_DEFAULTS, ensure_weight_bridge_settings, seed_master_data


TEST_DATES = ("2099-01-01", "2099-01-02", "2099-01-03", "2099-01-04")
test_ignore = ["Purchase Order", "Sales Order"]


class TestWeightBridgeTicket(FrappeTestCase):
	def setUp(self):
		seed_master_data()
		ensure_weight_bridge_settings()
		self._reset_weight_bridge_settings()
		self._ensure_test_trucks_and_drivers()
		for date in TEST_DATES:
			self._clear_tickets_for_date(date)

	def test_in_ticket_is_renamed_and_calculated_after_second_weight(self):
		ticket = self._new_ticket(first_weight=50000)
		ticket.insert(ignore_permissions=True)

		self.assertTrue(ticket.name.startswith("WB-990101-"))
		self.assertEqual(ticket.ticket_status, "Pending Second Weight")

		ticket.second_weight_datetime = "2099-01-01 15:30:00"
		ticket.second_weight = 16000
		provisional_name = ticket.name
		ticket.save(ignore_permissions=True)

		self.assertTrue(ticket.name.startswith("IN-990101-"))
		self.assertEqual(ticket.localname, provisional_name)
		self.assertEqual(ticket.direction, "IN")
		self.assertEqual(ticket.gross_weight, 50000)
		self.assertEqual(ticket.vehicle_weight, 16000)
		self.assertEqual(ticket.net_weight, 34000)
		self.assertEqual(ticket.ticket_status, "Finalized")

	def test_out_ticket_is_renamed_and_calculated_after_second_weight(self):
		ticket = self._new_ticket(date="2099-01-02", first_weight=14500)
		ticket.insert(ignore_permissions=True)

		ticket.second_weight_datetime = "2099-01-02 15:30:00"
		ticket.second_weight = 42000
		ticket.save(ignore_permissions=True)

		self.assertTrue(ticket.name.startswith("OUT-990102-"))
		self.assertEqual(ticket.direction, "OUT")
		self.assertEqual(ticket.gross_weight, 42000)
		self.assertEqual(ticket.vehicle_weight, 14500)
		self.assertEqual(ticket.net_weight, 27500)

	def test_equal_weights_are_rejected(self):
		ticket = self._new_ticket(date="2099-01-03", first_weight=20000)
		ticket.second_weight_datetime = "2099-01-03 15:30:00"
		ticket.second_weight = 20000

		with self.assertRaises(frappe.ValidationError):
			ticket.insert(ignore_permissions=True)

	def test_finalized_weight_fields_are_protected(self):
		ticket = self._new_ticket(date="2099-01-04", first_weight=50000)
		ticket.second_weight_datetime = "2099-01-04 15:30:00"
		ticket.second_weight = 15000
		ticket.insert(ignore_permissions=True)

		ticket.first_weight = 51000
		with self.assertRaises(frappe.ValidationError):
			ticket.save(ignore_permissions=True)

	def test_driver_details_are_fetched_from_phone_number(self):
		ticket = self._new_ticket()
		ticket.insert(ignore_permissions=True)

		self.assertEqual(ticket.driver, "+9647700000001")
		self.assertEqual(ticket.driver_name, "Test Driver")
		self.assertEqual(ticket.driver_passport_number, "P1234567")
		self.assertEqual(ticket.driver_national_code, "N1234567")

	def test_ticket_does_not_duplicate_driver_phone_number_field(self):
		fieldnames = {field.fieldname for field in frappe.get_meta("Weight Bridge Ticket").fields}

		self.assertIn("driver", fieldnames)
		self.assertNotIn("driver_phone_number", fieldnames)

	def test_driver_quick_entry_includes_all_driver_fields(self):
		meta = frappe.get_meta("Weight Bridge Driver")

		for fieldname in ("phone_number", "driver_name", "passport_number", "national_code"):
			self.assertEqual(meta.get_field(fieldname).allow_in_quick_entry, 1)

	def test_ticket_has_purchase_and_sales_order_references(self):
		meta = frappe.get_meta("Weight Bridge Ticket")

		self.assertEqual(meta.get_field("purchase_order").options, "Purchase Order")
		self.assertEqual(meta.get_field("sales_order").options, "Sales Order")

	def test_truck_details_layout_uses_three_columns(self):
		meta = frappe.get_meta("Weight Bridge Ticket")

		self.assertEqual(meta.get_field("truck_details_column_2").fieldtype, "Column Break")
		self.assertEqual(meta.get_field("truck_details_column_3").fieldtype, "Column Break")
		self.assertEqual(
			self._field_order_between(meta, "truck_details_section", "cargo_section"),
			[
				"plate_number",
				"driver",
				"truck_details_column_2",
				"driver_name",
				"driver_passport_number",
				"truck_details_column_3",
				"driver_national_code",
				"operator",
			],
		)

	def test_cargo_layout_uses_two_columns(self):
		meta = frappe.get_meta("Weight Bridge Ticket")

		self.assertEqual(meta.get_field("cargo_column_2").fieldtype, "Column Break")
		self.assertEqual(
			self._field_order_between(meta, "cargo_section", "weighing_section"),
			[
				"cargo_item",
				"purchase_order",
				"sales_order",
				"cargo_column_2",
				"origin_type",
				"origin",
				"destination_type",
				"destination",
			],
		)

	def test_weight_bridge_workspace_is_public_and_ordered_after_manufacturing(self):
		workspace = frappe.get_doc("Workspace", "Weight Bridge")
		manufacturing_sequence = frappe.db.get_value("Workspace", "Manufacturing", "sequence_id")
		quality_sequence = frappe.db.get_value("Workspace", "Quality", "sequence_id")

		self.assertEqual(workspace.public, 1)
		self.assertEqual(workspace.is_hidden, 0)
		self.assertEqual(workspace.icon, "weight-bridge")
		self.assertGreater(workspace.sequence_id, manufacturing_sequence)
		self.assertLess(workspace.sequence_id, quality_sequence)

	def test_weight_bridge_workspace_links_core_pages_and_reports(self):
		workspace = frappe.get_doc("Workspace", "Weight Bridge")
		links = {(link.label, link.link_to, link.link_type) for link in workspace.links if link.type == "Link"}

		for expected_link in (
			("Weight Bridge Ticket", "Weight Bridge Ticket", "DocType"),
			("Weight Bridge Truck", "Weight Bridge Truck", "DocType"),
			("Weight Bridge Driver", "Weight Bridge Driver", "DocType"),
			("Weight Bridge Settings", "Weight Bridge Settings", "DocType"),
			("Weight Bridge Ticket Register", "Weight Bridge Ticket Register", "Report"),
			("Daily Weight Bridge Summary", "Daily Weight Bridge Summary", "Report"),
			("Weight Bridge Order Summary", "Weight Bridge Order Summary", "Report"),
		):
			self.assertIn(expected_link, links)

	def test_weight_bridge_settings_defaults_are_available(self):
		meta = frappe.get_meta("Weight Bridge Settings")
		settings = frappe.get_single("Weight Bridge Settings")

		self.assertEqual(meta.issingle, 1)
		for fieldname, expected_value in WEIGHT_BRIDGE_SETTINGS_DEFAULTS.items():
			self.assertIsNotNone(meta.get_field(fieldname))
			self.assertEqual(settings.get(fieldname), expected_value)

	def test_settings_can_limit_maximum_gross_weight(self):
		self._set_settings(max_gross_weight_kg=1000)
		ticket = self._new_ticket(first_weight=50000)
		ticket.second_weight_datetime = "2099-01-01 11:00:00"
		ticket.second_weight = 16000

		with self.assertRaises(frappe.ValidationError):
			ticket.insert(ignore_permissions=True)

	def test_settings_can_require_purchase_order_for_in_tickets(self):
		self._set_settings(require_purchase_order_for_in=1)
		ticket = self._new_ticket(first_weight=50000)
		ticket.second_weight_datetime = "2099-01-01 11:00:00"
		ticket.second_weight = 16000

		with self.assertRaises(frappe.ValidationError):
			ticket.insert(ignore_permissions=True)

	def test_reports_return_weight_bridge_ticket_data(self):
		from weight_bridge.weight_bridge.report.daily_weight_bridge_summary.daily_weight_bridge_summary import (
			execute as execute_daily_summary,
		)
		from weight_bridge.weight_bridge.report.weight_bridge_order_summary.weight_bridge_order_summary import (
			execute as execute_order_summary,
		)
		from weight_bridge.weight_bridge.report.weight_bridge_ticket_register.weight_bridge_ticket_register import (
			execute as execute_ticket_register,
		)

		ticket = self._new_ticket(first_weight=50000)
		ticket.second_weight_datetime = "2099-01-01 11:00:00"
		ticket.second_weight = 16000
		ticket.insert(ignore_permissions=True)
		filters = {"from_date": "2099-01-01", "to_date": "2099-01-01"}

		_, register_rows = execute_ticket_register(filters)
		_, daily_rows = execute_daily_summary(filters)
		_, order_rows = execute_order_summary(filters)

		self.assertIn(ticket.name, {row.name for row in register_rows})
		self.assertTrue(any(row.direction == "IN" and row.truck_count == 1 for row in daily_rows))
		self.assertTrue(any(row.direction == "IN" and row.order_reference == "No Purchase Order" for row in order_rows))

	def test_same_day_in_and_out_sequences_are_separate(self):
		in_ticket = self._new_ticket(first_weight=50000)
		in_ticket.second_weight_datetime = "2099-01-01 11:00:00"
		in_ticket.second_weight = 16000
		in_ticket.insert(ignore_permissions=True)

		out_ticket = self._new_ticket(first_weight=16000)
		out_ticket.second_weight_datetime = "2099-01-01 12:00:00"
		out_ticket.second_weight = 50000
		out_ticket.insert(ignore_permissions=True)

		self.assertEqual(in_ticket.name, "IN-990101-01")
		self.assertEqual(out_ticket.name, "OUT-990101-01")

	def test_same_day_final_sequence_increments_per_direction(self):
		first_ticket = self._new_ticket(first_weight=50000)
		first_ticket.second_weight_datetime = "2099-01-01 11:00:00"
		first_ticket.second_weight = 16000
		first_ticket.insert(ignore_permissions=True)

		second_ticket = self._new_ticket(first_weight=48000)
		second_ticket.second_weight_datetime = "2099-01-01 12:00:00"
		second_ticket.second_weight = 15000
		second_ticket.insert(ignore_permissions=True)

		self.assertEqual(first_ticket.name, "IN-990101-01")
		self.assertEqual(second_ticket.name, "IN-990101-02")

	def test_finalized_ticket_can_be_submitted_and_cancelled(self):
		ticket = self._new_ticket(first_weight=50000)
		ticket.second_weight_datetime = "2099-01-01 11:00:00"
		ticket.second_weight = 16000
		ticket.insert(ignore_permissions=True)

		ticket.submit()
		self.assertEqual(ticket.docstatus, 1)

		ticket.cancel()
		self.assertEqual(ticket.docstatus, 2)

	def test_in_ticket_clears_irrelevant_sales_order(self):
		ticket = self._new_ticket(first_weight=50000)
		ticket.second_weight_datetime = "2099-01-01 15:30:00"
		ticket.second_weight = 16000
		ticket.sales_order = "SO-DOES-NOT-EXIST"
		ticket._set_calculated_fields()
		ticket._set_relevant_order_reference()

		self.assertEqual(ticket.direction, "IN")
		self.assertIsNone(ticket.sales_order)

	def test_out_ticket_clears_irrelevant_purchase_order(self):
		ticket = self._new_ticket(date="2099-01-02", first_weight=14500)
		ticket.second_weight_datetime = "2099-01-02 15:30:00"
		ticket.second_weight = 42000
		ticket.purchase_order = "PO-DOES-NOT-EXIST"
		ticket._set_calculated_fields()
		ticket._set_relevant_order_reference()

		self.assertEqual(ticket.direction, "OUT")
		self.assertIsNone(ticket.purchase_order)

	def _new_ticket(self, date="2099-01-01", first_weight=50000):
		return frappe.get_doc(
			{
				"doctype": "Weight Bridge Ticket",
				"plate_number": f"TEST-{date}",
				"driver": "+9647700000001",
				"operator": "Administrator",
				"cargo_item": "VR",
				"origin_type": "Warehouse",
				"origin": "Stores - PZT",
				"destination_type": "Warehouse",
				"destination": "Finished Goods - PZT",
				"first_weight_datetime": f"{date} 10:00:00",
				"first_weight": first_weight,
			}
		)

	def _clear_tickets_for_date(self, date):
		date_part = date[2:4] + date[5:7] + date[8:10]
		for prefix in ("WB", "IN", "OUT"):
			frappe.db.delete("Weight Bridge Ticket", {"name": ("like", f"{prefix}-{date_part}-%")})
			frappe.db.delete("Series", {"name": f"{prefix}-{date_part}-"})

	def _field_order_between(self, meta, start_fieldname, end_fieldname):
		field_order = [field.fieldname for field in meta.fields]
		start = field_order.index(start_fieldname) + 1
		end = field_order.index(end_fieldname)
		return field_order[start:end]

	def _reset_weight_bridge_settings(self):
		self._set_settings(**WEIGHT_BRIDGE_SETTINGS_DEFAULTS)

	def _set_settings(self, **kwargs):
		settings = frappe.get_single("Weight Bridge Settings")
		for fieldname, value in kwargs.items():
			settings.set(fieldname, value)
		settings.save(ignore_permissions=True)
		frappe.clear_cache(doctype="Weight Bridge Settings")

	def _ensure_test_trucks_and_drivers(self):
		for date in TEST_DATES:
			plate_number = f"TEST-{date}"
			if not frappe.db.exists("Weight Bridge Truck", plate_number):
				frappe.get_doc(
					{
						"doctype": "Weight Bridge Truck",
						"plate_number": plate_number,
					}
				).insert(ignore_permissions=True)

		if not frappe.db.exists("Weight Bridge Driver", "+9647700000001"):
			frappe.get_doc(
				{
					"doctype": "Weight Bridge Driver",
					"phone_number": "+9647700000001",
					"driver_name": "Test Driver",
					"passport_number": "P1234567",
					"national_code": "N1234567",
				}
			).insert(ignore_permissions=True)
