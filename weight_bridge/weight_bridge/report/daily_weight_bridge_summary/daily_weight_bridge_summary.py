import frappe
from frappe import _


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Date"), "fieldname": "posting_date", "fieldtype": "Date", "width": 120},
		{"label": _("Direction"), "fieldname": "direction", "fieldtype": "Data", "width": 90},
		{"label": _("Cargo Item"), "fieldname": "cargo_item", "fieldtype": "Link", "options": "Item", "width": 160},
		{"label": _("Truck Count"), "fieldname": "truck_count", "fieldtype": "Int", "width": 110},
		{"label": _("Gross Weight (Kg)"), "fieldname": "total_gross_weight", "fieldtype": "Float", "width": 150},
		{"label": _("Vehicle/Tare Weight (Kg)"), "fieldname": "total_vehicle_weight", "fieldtype": "Float", "width": 180},
		{"label": _("Net Weight (Kg)"), "fieldname": "total_net_weight", "fieldtype": "Float", "width": 150},
		{"label": _("Average Net Weight (Kg)"), "fieldname": "average_net_weight", "fieldtype": "Float", "width": 180},
	]


def get_data(filters):
	conditions, values = get_conditions(filters)
	return frappe.db.sql(
		f"""
		select
			date(wbt.first_weight_datetime) as posting_date,
			wbt.direction,
			wbt.cargo_item,
			count(wbt.name) as truck_count,
			sum(wbt.gross_weight) as total_gross_weight,
			sum(wbt.vehicle_weight) as total_vehicle_weight,
			sum(wbt.net_weight) as total_net_weight,
			avg(wbt.net_weight) as average_net_weight
		from `tabWeight Bridge Ticket` wbt
		where {" and ".join(conditions)}
		group by date(wbt.first_weight_datetime), wbt.direction, wbt.cargo_item
		order by posting_date desc, wbt.direction asc, wbt.cargo_item asc
		""",
		values,
		as_dict=True,
	)


def get_conditions(filters):
	conditions = ["wbt.docstatus < 2", "wbt.direction in ('IN', 'OUT')", "wbt.ticket_status = 'Finalized'"]
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
	if filters.get("cargo_item"):
		conditions.append("wbt.cargo_item = %(cargo_item)s")
		values["cargo_item"] = filters.cargo_item

	return conditions, values
