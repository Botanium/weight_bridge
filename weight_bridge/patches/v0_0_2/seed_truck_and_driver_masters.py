import frappe

from weight_bridge.install import ensure_roles_and_permissions


def execute():
	ensure_trucks_from_existing_tickets()
	ensure_roles_and_permissions()


def ensure_trucks_from_existing_tickets():
	if not frappe.db.table_exists("Weight Bridge Ticket") or not frappe.db.table_exists("Weight Bridge Truck"):
		return

	plate_numbers = frappe.get_all(
		"Weight Bridge Ticket",
		filters={"plate_number": ("is", "set")},
		pluck="plate_number",
		distinct=True,
	)

	for plate_number in plate_numbers:
		ensure_truck(plate_number)


def ensure_truck(plate_number):
	if not plate_number or frappe.db.exists("Weight Bridge Truck", plate_number):
		return

	frappe.get_doc(
		{
			"doctype": "Weight Bridge Truck",
			"plate_number": plate_number,
		}
	).insert(ignore_permissions=True)
