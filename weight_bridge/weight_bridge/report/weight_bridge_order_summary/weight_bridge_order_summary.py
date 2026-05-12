import frappe
from frappe import _


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Direction"), "fieldname": "direction", "fieldtype": "Data", "width": 90},
		{"label": _("Order Type"), "fieldname": "order_type", "fieldtype": "Data", "width": 130},
		{"label": _("Order Reference"), "fieldname": "order_reference", "fieldtype": "Data", "width": 180},
		{"label": _("Cargo Item"), "fieldname": "cargo_item", "fieldtype": "Link", "options": "Item", "width": 160},
		{"label": _("Origin Type"), "fieldname": "origin_type", "fieldtype": "Data", "width": 110},
		{"label": _("Origin"), "fieldname": "origin", "fieldtype": "Data", "width": 180},
		{"label": _("Truck Count"), "fieldname": "truck_count", "fieldtype": "Int", "width": 110},
		{"label": _("Net Weight (Kg)"), "fieldname": "total_net_weight", "fieldtype": "Float", "width": 150},
		{"label": _("First Ticket Date"), "fieldname": "first_ticket_date", "fieldtype": "Date", "width": 130},
		{"label": _("Last Ticket Date"), "fieldname": "last_ticket_date", "fieldtype": "Date", "width": 130},
	]


def get_data(filters):
	conditions, values = get_conditions(filters)
	return frappe.db.sql(
		f"""
		select
			wbt.direction,
			case when wbt.direction = 'IN' then 'Purchase Order' else 'Sales Order' end as order_type,
			case
				when wbt.direction = 'IN' then coalesce(nullif(wbt.purchase_order, ''), 'No Purchase Order')
				else coalesce(nullif(wbt.sales_order, ''), 'No Sales Order')
			end as order_reference,
			wbt.cargo_item,
			wbt.origin_type,
			wbt.origin,
			count(wbt.name) as truck_count,
			sum(wbt.net_weight) as total_net_weight,
			min(date(wbt.first_weight_datetime)) as first_ticket_date,
			max(date(wbt.first_weight_datetime)) as last_ticket_date
		from `tabWeight Bridge Ticket` wbt
		where {" and ".join(conditions)}
		group by
			wbt.direction,
			order_type,
			order_reference,
			wbt.cargo_item,
			wbt.origin_type,
			wbt.origin
		order by last_ticket_date desc, wbt.direction asc, order_reference asc
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
	if filters.get("purchase_order"):
		conditions.append("wbt.purchase_order = %(purchase_order)s")
		values["purchase_order"] = filters.purchase_order
	if filters.get("sales_order"):
		conditions.append("wbt.sales_order = %(sales_order)s")
		values["sales_order"] = filters.sales_order

	return conditions, values
