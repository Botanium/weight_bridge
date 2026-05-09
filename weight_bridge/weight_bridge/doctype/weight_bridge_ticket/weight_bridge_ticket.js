const WEIGHT_BRIDGE_SERIAL_BAUD_RATE_KEY = "weight_bridge.scale_baud_rate";
const WEIGHT_BRIDGE_DEFAULT_BAUD_RATE = 9600;

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
		render_serial_port_controls(frm);
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

function render_serial_port_controls(frm) {
	const field = frm.get_field("serial_port_status_html");
	if (!field?.$wrapper) {
		return;
	}

	const controller = ensure_serial_scale_controller(frm);
	const latest_reading = controller?.getLatestReading();
	const baud_rate = get_stored_baud_rate();
	const unsupported = controller && !controller.isSupported();

	field.$wrapper.closest(".frappe-control").removeClass("input-max-width").css("max-width", "none");
	field.$wrapper.html(`
		<div class="weight-bridge-serial-panel" data-weight-bridge-serial-panel>
			<style>
				.weight-bridge-serial-panel {
					border: 1px solid var(--border-color);
					border-radius: 8px;
					margin-bottom: 12px;
					padding: 12px;
				}
				.weight-bridge-serial-grid {
					align-items: end;
					display: grid;
					gap: 12px;
					grid-template-columns: minmax(180px, 1fr) minmax(120px, 160px) auto;
				}
				.weight-bridge-serial-actions {
					display: flex;
					flex-wrap: wrap;
					gap: 8px;
					justify-content: flex-end;
				}
				.weight-bridge-serial-meta {
					display: flex;
					flex-wrap: wrap;
					gap: 12px;
					margin-top: 10px;
				}
				.weight-bridge-serial-raw {
					font-family: var(--font-stack-monospace);
					max-width: 100%;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
				}
				@media (max-width: 767px) {
					.weight-bridge-serial-grid {
						grid-template-columns: 1fr;
					}
					.weight-bridge-serial-actions {
						justify-content: flex-start;
					}
				}
			</style>
			<div class="weight-bridge-serial-grid">
				<div>
					<div class="text-muted small">${__("Scale Port")}</div>
					<div>
						<strong data-weight-bridge-serial-status>${escape_html(get_serial_status_label(controller))}</strong>
					</div>
					<div class="text-muted small">${__("Latest Weight")}: <span data-weight-bridge-serial-weight>${escape_html(format_serial_weight(latest_reading))}</span></div>
				</div>
				<div>
					<label class="control-label small" for="weight-bridge-serial-baud-rate">${__("Baud Rate")}</label>
					<input
						class="form-control input-sm"
						data-weight-bridge-serial-baud-rate
						id="weight-bridge-serial-baud-rate"
						inputmode="numeric"
						min="1"
						type="number"
						value="${escape_html(baud_rate)}"
					>
				</div>
				<div class="weight-bridge-serial-actions">
					<button class="btn btn-xs btn-default" data-weight-bridge-serial-action="open" type="button">${__("Open Port")}</button>
					<button class="btn btn-xs btn-default" data-weight-bridge-serial-action="capture-first" type="button">${__("Read First Weight")}</button>
					<button class="btn btn-xs btn-default" data-weight-bridge-serial-action="capture-second" type="button">${__("Read Second Weight")}</button>
					<button class="btn btn-xs btn-default" data-weight-bridge-serial-action="close" type="button">${__("Close Port")}</button>
				</div>
			</div>
			<div class="weight-bridge-serial-meta text-muted small">
				<span>${__("Scale Status")}: <span data-weight-bridge-serial-scale-status>${escape_html(format_status_code(latest_reading))}</span></span>
				<span>${__("Raw")}: <span class="weight-bridge-serial-raw" data-weight-bridge-serial-raw>${escape_html(format_raw_chunk(latest_reading))}</span></span>
			</div>
			${unsupported ? `<div class="text-muted small margin-top">${__("Web Serial requires Chrome or Edge over HTTPS, or localhost during local testing.")}</div>` : ""}
		</div>
	`);

	bind_serial_port_controls(frm);
	update_serial_port_controls(frm);
}

function bind_serial_port_controls(frm) {
	const wrapper = frm.get_field("serial_port_status_html")?.$wrapper;
	if (!wrapper) {
		return;
	}

	wrapper.find("[data-weight-bridge-serial-action='open']").on("click", () => open_serial_port(frm));
	wrapper.find("[data-weight-bridge-serial-action='close']").on("click", () => close_serial_port(frm));
	wrapper.find("[data-weight-bridge-serial-action='capture-first']").on("click", () => capture_serial_weight(frm, "first_weight"));
	wrapper.find("[data-weight-bridge-serial-action='capture-second']").on("click", () => capture_serial_weight(frm, "second_weight"));
	wrapper.find("[data-weight-bridge-serial-baud-rate]").on("change", () => {
		const baud_rate = get_baud_rate_from_form(frm);
		store_baud_rate(baud_rate);
	});
}

function ensure_serial_scale_controller(frm) {
	const serial_api = window.weight_bridge?.SerialScale;
	if (!serial_api?.createController) {
		return null;
	}

	if (!frm.weight_bridge_serial_controller) {
		frm.weight_bridge_serial_controller = serial_api.createController({
			onReading: () => update_serial_port_controls(frm),
			onStatusChange: () => update_serial_port_controls(frm),
			onError: (error) => {
				frappe.show_alert({
					message: __("Scale port error: {0}", [error.message || String(error)]),
					indicator: "red",
				});
				update_serial_port_controls(frm);
			},
		});
	}

	return frm.weight_bridge_serial_controller;
}

async function open_serial_port(frm) {
	const controller = ensure_serial_scale_controller(frm);
	if (!controller) {
		frappe.msgprint(__("The Weight Bridge serial script is not loaded. Please refresh after rebuilding assets."));
		return;
	}
	if (!controller.isSupported()) {
		frappe.msgprint(__("Web Serial is available in Chrome or Edge over HTTPS. It is not available in this browser."));
		return;
	}

	try {
		const baud_rate = get_baud_rate_from_form(frm);
		store_baud_rate(baud_rate);
		await controller.open({ baudRate: baud_rate });
		frappe.show_alert({ message: __("Scale port opened."), indicator: "green" });
		update_serial_port_controls(frm);
	} catch (error) {
		if (error.name === "NotFoundError") {
			frappe.show_alert({ message: __("No serial port was selected."), indicator: "orange" });
			return;
		}

		frappe.msgprint({
			title: __("Could Not Open Scale Port"),
			message: error.message || String(error),
			indicator: "red",
		});
		update_serial_port_controls(frm);
	}
}

async function close_serial_port(frm) {
	const controller = ensure_serial_scale_controller(frm);
	if (!controller) {
		return;
	}

	await controller.close();
	frappe.show_alert({ message: __("Scale port closed."), indicator: "blue" });
	update_serial_port_controls(frm);
}

async function capture_serial_weight(frm, fieldname) {
	if (is_weight_capture_locked(frm)) {
		frappe.msgprint(__("This ticket is finalized or submitted, so the weighing fields cannot be changed."));
		return;
	}

	const controller = ensure_serial_scale_controller(frm);
	const reading = controller?.getLatestReading();
	const weight = Number(reading?.weight);

	if (!Number.isFinite(weight) || weight <= 0) {
		frappe.msgprint(__("No positive scale reading is available yet. Open the port and wait for the weight to appear."));
		return;
	}

	const datetime_fieldname = fieldname === "first_weight" ? "first_weight_datetime" : "second_weight_datetime";
	await frm.set_value(fieldname, weight);
	if (!frm.doc[datetime_fieldname]) {
		await frm.set_value(datetime_fieldname, frappe.datetime.now_datetime());
	}

	set_order_reference_visibility(frm);
	frappe.show_alert({
		message: __("{0} updated from scale: {1} Kg", [get_field_label(frm, fieldname), format_number(weight)]),
		indicator: "green",
	});
}

function update_serial_port_controls(frm) {
	const wrapper = frm.get_field("serial_port_status_html")?.$wrapper;
	if (!wrapper?.length) {
		return;
	}

	const controller = ensure_serial_scale_controller(frm);
	const latest_reading = controller?.getLatestReading();
	const connected = controller?.isConnected();
	const busy = ["selecting", "disconnecting"].includes(controller?.status);
	const locked = is_weight_capture_locked(frm);
	const has_positive_weight = Number(latest_reading?.weight) > 0;

	wrapper.find("[data-weight-bridge-serial-status]").text(get_serial_status_label(controller));
	wrapper.find("[data-weight-bridge-serial-weight]").text(format_serial_weight(latest_reading));
	wrapper.find("[data-weight-bridge-serial-scale-status]").text(format_status_code(latest_reading));
	wrapper.find("[data-weight-bridge-serial-raw]").text(format_raw_chunk(latest_reading));
	wrapper.find("[data-weight-bridge-serial-action='open']").prop("disabled", busy || connected || !controller?.isSupported());
	wrapper.find("[data-weight-bridge-serial-action='close']").prop("disabled", busy || !connected);
	wrapper.find("[data-weight-bridge-serial-action='capture-first']").prop("disabled", locked || !has_positive_weight);
	wrapper.find("[data-weight-bridge-serial-action='capture-second']").prop("disabled", locked || !has_positive_weight);
}

function get_serial_status_label(controller) {
	const status = controller?.status || "not_loaded";
	const labels = {
		connected: __("Connected"),
		disconnected: __("Disconnected"),
		disconnecting: __("Closing"),
		error: __("Error"),
		not_loaded: __("Serial script not loaded"),
		reading: __("Reading"),
		selecting: __("Select a serial port"),
	};

	return labels[status] || status;
}

function is_weight_capture_locked(frm) {
	return frm.doc.docstatus !== 0 || (frm.doc.name && !frm.doc.__islocal && !frm.doc.name.startsWith("WB-"));
}

function get_baud_rate_from_form(frm) {
	const value = frm.get_field("serial_port_status_html")?.$wrapper?.find("[data-weight-bridge-serial-baud-rate]").val();
	const baud_rate = Number(value || get_stored_baud_rate());

	return Number.isFinite(baud_rate) && baud_rate > 0 ? baud_rate : WEIGHT_BRIDGE_DEFAULT_BAUD_RATE;
}

function get_stored_baud_rate() {
	try {
		const baud_rate = Number(window.localStorage?.getItem(WEIGHT_BRIDGE_SERIAL_BAUD_RATE_KEY));
		return Number.isFinite(baud_rate) && baud_rate > 0 ? baud_rate : WEIGHT_BRIDGE_DEFAULT_BAUD_RATE;
	} catch (error) {
		return WEIGHT_BRIDGE_DEFAULT_BAUD_RATE;
	}
}

function store_baud_rate(baud_rate) {
	try {
		window.localStorage?.setItem(WEIGHT_BRIDGE_SERIAL_BAUD_RATE_KEY, String(baud_rate));
	} catch (error) {
		// Browsers can block localStorage in private or restricted contexts.
	}
}

function format_serial_weight(reading) {
	if (!reading || reading.weight === null || reading.weight === undefined) {
		return __("No reading yet");
	}

	return `${format_number(reading.weight)} Kg`;
}

function format_status_code(reading) {
	if (!reading?.statusCode) {
		return __("No status code");
	}

	return reading.statusCode;
}

function format_raw_chunk(reading) {
	if (!reading?.rawBuffer) {
		return __("No data yet");
	}

	return reading.rawBuffer.replace(/\s+/g, " ").trim();
}

function format_number(value) {
	const number_value = Number(value);
	if (!Number.isFinite(number_value)) {
		return "";
	}

	return number_value.toLocaleString(undefined, {
		maximumFractionDigits: 3,
	});
}

function get_field_label(frm, fieldname) {
	return frm.fields_dict[fieldname]?.df?.label || fieldname;
}

function escape_html(value) {
	return String(value ?? "").replace(/[&<>"']/g, (character) => {
		const entities = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		};
		return entities[character];
	});
}
