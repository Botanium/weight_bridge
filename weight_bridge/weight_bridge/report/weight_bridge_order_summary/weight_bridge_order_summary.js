frappe.query_reports["Weight Bridge Order Summary"] = {
	filters: [
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "direction",
			label: __("Direction"),
			fieldtype: "Select",
			options: "\nIN\nOUT",
		},
		{
			fieldname: "cargo_item",
			label: __("Cargo Item"),
			fieldtype: "Link",
			options: "Item",
		},
		{
			fieldname: "purchase_order",
			label: __("Purchase Order"),
			fieldtype: "Link",
			options: "Purchase Order",
		},
		{
			fieldname: "sales_order",
			label: __("Sales Order"),
			fieldtype: "Link",
			options: "Sales Order",
		},
	],
};
