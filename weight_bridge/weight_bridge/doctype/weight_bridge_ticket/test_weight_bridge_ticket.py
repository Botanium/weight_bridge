import frappe
from frappe.tests.utils import FrappeTestCase

from weight_bridge.install import seed_master_data


TEST_DATES = ("2099-01-01", "2099-01-02", "2099-01-03", "2099-01-04")


class TestWeightBridgeTicket(FrappeTestCase):
	def setUp(self):
		seed_master_data()
		for date in TEST_DATES:
			self._clear_tickets_for_date(date)

	def test_in_ticket_is_renamed_and_calculated_after_second_weight(self):
		ticket = self._new_ticket(first_weight=50000)
		ticket.insert(ignore_permissions=True)

		self.assertTrue(ticket.name.startswith("WB-990101-"))
		self.assertEqual(ticket.ticket_status, "Pending Second Weight")

		ticket.second_weight_datetime = "2099-01-01 15:30:00"
		ticket.second_weight = 16000
		ticket.save(ignore_permissions=True)

		self.assertTrue(ticket.name.startswith("IN-990101-"))
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

	def _new_ticket(self, date="2099-01-01", first_weight=50000):
		return frappe.get_doc(
			{
				"doctype": "Weight Bridge Ticket",
				"plate_number": f"TEST-{date}",
				"driver_name": "Test Driver",
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
