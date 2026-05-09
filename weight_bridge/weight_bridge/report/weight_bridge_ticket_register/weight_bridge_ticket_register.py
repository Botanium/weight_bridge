import frappe
from frappe import _


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Ticket"), "fieldname": "name", "fieldtype": "Link", "options": "Weight Bridge Ticket", "width": 150},
		{"label": _("First Weight Date"), "fieldname": "first_weight_date", "fieldtype": "Date", "width": 120},
		{"label": _("Direction"), "fieldname": "direction", "fieldtype": "Data", "width": 80},
		{"label": _("Status"), "fieldname": "ticket_status", "fieldtype": "Data", "width": 150},
		{"label": _("Plate Number"), "fieldname": "plate_number", "fieldtype": "Link", "options": "Weight Bridge Truck", "width": 130},
		{"label": _("Driver Phone"), "fieldname": "driver", "fieldtype": "Link", "options": "Weight Bridge Driver", "width": 140},
		{"label": _("Driver Name"), "fieldname": "driver_name", "fieldtype": "Data", "width": 180},
		{"label": _("Cargo Item"), "fieldname": "cargo_item", "fieldtype": "Link", "options": "Item", "width": 150},
		{"label": _("Purchase Order"), "fieldname": "purchase_order", "fieldtype": "Link", "options": "Purchase Order", "width": 150},
		{"label": _("Sales Order"), "fieldname": "sales_order", "fieldtype": "Link", "options": "Sales Order", "width": 150},
		{"label": _("Origin Type"), "fieldname": "origin_type", "fieldtype": "Data", "width": 110},
		{"label": _("Origin"), "fieldname": "origin", "fieldtype": "Dynamic Link", "options": "origin_type", "width": 180},
		{"label": _("Destination Type"), "fieldname": "destination_type", "fieldtype": "Data", "width": 130},
		{"label": _("Destination"), "fieldname": "destination", "fieldtype": "Dynamic Link", "options": "destination_type", "width": 180},
		{"label": _("Gross Weight (Kg)"), "fieldname": "gross_weight", "fieldtype": "Float", "width": 140},
		{"label": _("Vehicle/Tare Weight (Kg)"), "fieldname": "vehicle_weight", "fieldtype": "Float", "width": 170},
		{"label": _("Net Weight (Kg)"), "fieldname": "net_weight", "fieldtype": "Float", "width": 130},
		{"label": _("First Weight Date and Time"), "fieldname": "first_weight_datetime", "fieldtype": "Datetime", "width": 180},
		{"label": _("Second Weight Date and Time"), "fieldname": "second_weight_datetime", "fieldtype": "Datetime", "width": 180},
		{"label": _("Operator"), "fieldname": "operator", "fieldtype": "Link", "options": "User", "width": 180},
	]


def get_data(filters):
	conditions, values = get_conditions(filters)
	return frappe.db.sql(
		f"""
		select
			wbt.name,
			date(wbt.first_weight_datetime) as first_weight_date,
			wbt.direction,
			wbt.ticket_status,
			wbt.plate_number,
			wbt.driver,
			wbt.driver_name,
			wbt.cargo_item,
			wbt.purchase_order,
			wbt.sales_order,
			wbt.origin_type,
			wbt.origin,
			wbt.destination_type,
			wbt.destination,
			wbt.gross_weight,
			wbt.vehicle_weight,
			wbt.net_weight,
			wbt.first_weight_datetime,
			wbt.second_weight_datetime,
			wbt.operator
		from `tabWeight Bridge Ticket` wbt
		where {" and ".join(conditions)}
		order by wbt.first_weight_datetime desc, wbt.name desc
		""",
		values,
		as_dict=True,
	)


def get_conditions(filters):
	conditions = ["wbt.docstatus < 2"]
	values = {}

	if filters.get("from_date"):
		conditions.append("date(wbt.first_weight_datetime) >= %(from_date)s")
		values["from_date"] = filters.from_date
	if filters.get("to_date"):
		conditions.append("date(wbt.first_weight_datetime) <= %(to_date)s")
		values["to_date"] = filters.to_date
	if filters.get("direction"):
		conditions.append("wbt.direction = %(direction)s")
		values["direction"] = filters.direction
	if filters.get("ticket_status"):
		conditions.append("wbt.ticket_status = %(ticket_status)s")
		values["ticket_status"] = filters.ticket_status
	if filters.get("cargo_item"):
		conditions.append("wbt.cargo_item = %(cargo_item)s")
		values["cargo_item"] = filters.cargo_item
	if filters.get("plate_number"):
		conditions.append("wbt.plate_number = %(plate_number)s")
		values["plate_number"] = filters.plate_number
	if filters.get("driver"):
		conditions.append("wbt.driver = %(driver)s")
		values["driver"] = filters.driver

	return conditions, values
