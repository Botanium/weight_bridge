from frappe import _


def get_data():
	transactions = [
		{"label": _("Orders"), "items": ["Purchase Order", "Sales Order"]},
		{"label": _("References"), "items": ["Weight Bridge Truck", "Weight Bridge Driver", "Item"]},
	]

	if _doctype_exists("Laboratory Truck Test"):
		transactions.insert(0, {"label": _("Laboratory"), "items": ["Laboratory Truck Test"]})

	return {
		"fieldname": "weight_bridge_ticket",
		"internal_links": {
			"Purchase Order": "purchase_order",
			"Sales Order": "sales_order",
			"Weight Bridge Truck": "plate_number",
			"Weight Bridge Driver": "driver",
			"Item": "cargo_item",
		},
		"transactions": transactions,
	}


def _doctype_exists(doctype):
	try:
		import frappe

		return frappe.db.exists("DocType", doctype)
	except Exception:
		return False
