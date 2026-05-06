frappe.ui.form.on("Weight Bridge Ticket", {
	setup(frm) {
		frm.set_query("cargo_item", () => ({
			filters: {
				disabled: 0,
			},
		}));
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
	},
});
