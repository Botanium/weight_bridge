frappe.query_reports["Weight Bridge Ticket Register"] = {
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
			fieldname: "ticket_status",
			label: __("Ticket Status"),
			fieldtype: "Select",
			options: "\nPending Second Weight\nFinalized",
		},
		{
			fieldname: "cargo_item",
			label: __("Cargo Item"),
			fieldtype: "Link",
			options: "Item",
		},
		{
			fieldname: "plate_number",
			label: __("Plate Number"),
			fieldtype: "Link",
			options: "Weight Bridge Truck",
		},
		{
			fieldname: "driver",
			label: __("Driver Phone Number"),
			fieldtype: "Link",
			options: "Weight Bridge Driver",
		},
	],
};
