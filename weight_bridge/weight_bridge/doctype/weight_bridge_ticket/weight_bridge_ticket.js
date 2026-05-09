frappe.ui.form.on("Weight Bridge Ticket", {
	setup(frm) {
		frm.set_query("cargo_item", () => ({
			filters: {
				disabled: 0,
			},
		}));

		frm.set_query("purchase_order", () => {
			const filters = {
				docstatus: 1,
				status: ["not in", ["Cancelled", "Closed"]],
			};

			if (frm.doc.origin_type === "Supplier" && frm.doc.origin) {
				filters.supplier = frm.doc.origin;
			}

			return { filters };
		});

		frm.set_query("sales_order", () => {
			const filters = {
				docstatus: 1,
				status: ["not in", ["Cancelled", "Closed"]],
			};

			if (frm.doc.destination_type === "Customer" && frm.doc.destination) {
				filters.customer = frm.doc.destination;
			}

			return { filters };
		});
	},

	before_save(frm) {
		frm.weight_bridge_name_before_save = frm.doc.name;
	},

	after_save(frm) {
		const old_name = frm.weight_bridge_name_before_save;
		const new_name = get_saved_ticket_name(frm);

		if (!old_name || !old_name.startsWith("WB-") || !new_name || new_name === old_name) {
			return;
		}

		frm.docname = new_name;
		frm.doc = locals[frm.doctype]?.[new_name] || frm.doc;
		frappe.set_route("Form", frm.doctype, new_name);
	},

	refresh(frm) {
		const finalized = frm.doc.name && !frm.doc.__islocal && !frm.doc.name.startsWith("WB-");
		const protected_fields = [
			"first_weight_datetime",
			"second_weight_datetime",
			"first_weight",
			"second_weight",
		];

		protected_fields.forEach((fieldname) => frm.set_df_property(fieldname, "read_only", finalized ? 1 : 0));
		set_order_reference_visibility(frm);
	},

	first_weight(frm) {
		set_order_reference_visibility(frm);
	},

	second_weight(frm) {
		set_order_reference_visibility(frm);
	},

	direction(frm) {
		set_order_reference_visibility(frm);
	},

	origin_type(frm) {
		clear_purchase_order_if_supplier_changed(frm);
	},

	origin(frm) {
		clear_purchase_order_if_supplier_changed(frm);
	},

	destination_type(frm) {
		clear_sales_order_if_customer_changed(frm);
	},

	destination(frm) {
		clear_sales_order_if_customer_changed(frm);
	},
});

function get_saved_ticket_name(frm) {
	const response_docs = frappe.last_response?.docs || [];
	const saved_doc = response_docs.find((doc) => doc.doctype === frm.doctype);
	const response_name = saved_doc?.name;

	if (response_name && /^(IN|OUT)-/.test(response_name)) {
		return response_name;
	}

	if (frm.doc.name && /^(IN|OUT)-/.test(frm.doc.name)) {
		return frm.doc.name;
	}
}

function set_order_reference_visibility(frm) {
	const direction = get_ticket_direction(frm);
	const show_purchase_order = direction === "IN";
	const show_sales_order = direction === "OUT";

	frm.toggle_display("purchase_order", show_purchase_order);
	frm.toggle_display("sales_order", show_sales_order);

	if (show_purchase_order && frm.doc.sales_order) {
		frm.set_value("sales_order", null);
	} else if (show_sales_order && frm.doc.purchase_order) {
		frm.set_value("purchase_order", null);
	}
}

function get_ticket_direction(frm) {
	const first_weight = flt(frm.doc.first_weight);
	const second_weight = flt(frm.doc.second_weight);

	if (first_weight > 0 && second_weight > 0 && first_weight !== second_weight) {
		return first_weight > second_weight ? "IN" : "OUT";
	}

	return frm.doc.direction;
}

function clear_purchase_order_if_supplier_changed(frm) {
	if (frm.doc.purchase_order) {
		frm.set_value("purchase_order", null);
	}
}

function clear_sales_order_if_customer_changed(frm) {
	if (frm.doc.sales_order) {
		frm.set_value("sales_order", null);
	}
}
