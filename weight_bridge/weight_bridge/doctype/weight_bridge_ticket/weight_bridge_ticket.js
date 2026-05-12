const WEIGHT_BRIDGE_DEFAULT_SCALE_SETTINGS = {
	auto_connect_scale: 1,
	serial_baud_rate: 9600,
	stable_reading_count: 3,
	stable_status_codes: "A",
	stability_tolerance_kg: 0.001,
	min_net_weight_kg: 1,
};

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
			return {
				filters: {
					docstatus: 1,
					status: ["not in", ["Cancelled", "Closed"]],
				},
			};
		});
	},

	before_save(frm) {
		frm.weight_bridge_name_before_save = frm.doc.name;
	},

	after_save(frm) {
		reset_scale_capture_state(frm);
		frm.weight_bridge_first_weight_captured_this_session = false;

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
		const protected_fields = [
			"first_weight_datetime",
			"second_weight_datetime",
			"first_weight",
			"second_weight",
		];

		protected_fields.forEach((fieldname) => frm.set_df_property(fieldname, "read_only", 1));
		initialize_visible_weighing_fields(frm);
		clear_saved_scale_capture_guard(frm);
		set_dynamic_weight_labels(frm);
		set_order_reference_visibility(frm);
		render_weight_capture_buttons(frm);
		initialize_scale_connection(frm);
	},

	first_weight(frm) {
		set_order_reference_visibility(frm);
		set_dynamic_weight_labels(frm);
		render_weight_capture_buttons(frm);
	},

	second_weight(frm) {
		set_order_reference_visibility(frm);
		set_dynamic_weight_labels(frm);
		render_weight_capture_buttons(frm);
	},

	direction(frm) {
		set_order_reference_visibility(frm);
		set_dynamic_weight_labels(frm);
		render_weight_capture_buttons(frm);
	},

	origin_type(frm) {
		clear_purchase_order_if_supplier_changed(frm);
	},

	origin(frm) {
		clear_purchase_order_if_supplier_changed(frm);
	},

	set_first_weight_button(frm) {
		capture_latest_scale_weight(frm, "first_weight");
	},

	set_second_weight_button(frm) {
		capture_latest_scale_weight(frm, "second_weight");
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

function ensure_serial_scale_controller(frm) {
	const serial_api = normalize_serial_scale_api(window.weight_bridge?.SerialScale);
	if (!serial_api?.createController) {
		return null;
	}

	if (!frm.weight_bridge_serial_controller) {
		frm.weight_bridge_serial_controller = serial_api.createController({
			onReading: (reading) => handle_scale_reading(frm, reading),
			onStatusChange: () => update_scale_status(frm),
			onError: (error) => {
				frappe.show_alert({
					message: __("Scale port error: {0}", [error.message || String(error)]),
					indicator: "red",
				});
				update_scale_status(frm);
			},
		});
		frm.weight_bridge_stable_state = serial_api.createStableReadingState();
	}

	return frm.weight_bridge_serial_controller;
}

function normalize_serial_scale_api(serial_api) {
	if (!serial_api?.createController) {
		return null;
	}

	if (!serial_api.createStableReadingState) {
		serial_api.createStableReadingState = create_stable_reading_state;
	}
	if (!serial_api.updateStableReading) {
		serial_api.updateStableReading = update_stable_reading;
	}

	return serial_api;
}

function reset_scale_capture_state(frm) {
	const serial_api = normalize_serial_scale_api(window.weight_bridge?.SerialScale);
	frm.weight_bridge_stable_state = serial_api?.createStableReadingState
		? serial_api.createStableReadingState()
		: create_stable_reading_state();
	frm.weight_bridge_latest_stable_result = null;
}

function clear_saved_scale_capture_guard(frm) {
	if (
		!frm.doc.__islocal &&
		frm.doc.name &&
		frm.doc.name.startsWith("WB-") &&
		flt(frm.doc.first_weight) > 0 &&
		flt(frm.doc.second_weight) <= 0
	) {
		frm.weight_bridge_first_weight_captured_this_session = false;
	}
}

function initialize_visible_weighing_fields(frm) {
	if (is_empty_value(frm.doc.first_weight)) {
		frm.set_value("first_weight", 0);
	}
	if (is_empty_value(frm.doc.second_weight)) {
		frm.set_value("second_weight", 0);
	}
	if (is_empty_value(frm.doc.gross_weight)) {
		frm.set_value("gross_weight", 0);
	}
	if (is_empty_value(frm.doc.vehicle_weight)) {
		frm.set_value("vehicle_weight", 0);
	}
	if (is_empty_value(frm.doc.net_weight)) {
		frm.set_value("net_weight", 0);
	}
	if (frm.doc.__islocal && !frm.doc.first_weight_datetime) {
		frm.set_value("first_weight_datetime", get_now_datetime_value());
	}
}

function initialize_scale_connection(frm) {
	const controller = ensure_serial_scale_controller(frm);
	if (!controller) {
		show_scale_status(frm, __("Scale script not loaded"), "orange");
		return;
	}

	bind_scale_lifecycle(frm);
	render_scale_toolbar(frm);
	update_scale_status(frm);

	if (!controller.isSupported()) {
		show_scale_status(frm, __("Scale unavailable: use Chrome or Edge with HTTPS"), "orange");
		return;
	}

	load_scale_settings(frm).then((settings) => {
		frm.weight_bridge_scale_settings = settings;
		if (Number(settings.auto_connect_scale) && !controller.isConnected() && !frm.weight_bridge_auto_connect_attempted) {
			frm.weight_bridge_auto_connect_attempted = true;
			connect_authorized_scale(frm);
		}
		update_scale_status(frm);
	});
}

function bind_scale_lifecycle(frm) {
	const active_frm = window.weight_bridge_active_scale_form;
	if (active_frm && active_frm !== frm) {
		close_scale_connection(active_frm, { silent: true }).catch(() => {});
	}

	window.weight_bridge_active_scale_form = frm;

	if (!window.weight_bridge_scale_global_lifecycle_bound) {
		window.weight_bridge_scale_global_lifecycle_bound = true;
		$(window).on("beforeunload.weight_bridge_scale", () => {
			const active_frm = window.weight_bridge_active_scale_form;
			if (active_frm) {
				close_scale_connection(active_frm, { silent: true }).catch(() => {});
			}
		});

		if (frappe.router?.on) {
			frappe.router.on("change", () => {
				const active_frm = window.weight_bridge_active_scale_form;
				if (!active_frm) {
					return;
				}

				const route = frappe.get_route ? frappe.get_route() : [];
				const still_on_ticket_form = route?.[0] === "Form" && route?.[1] === "Weight Bridge Ticket";
				if (!still_on_ticket_form) {
					close_scale_connection(active_frm, { silent: true }).catch(() => {});
					window.weight_bridge_active_scale_form = null;
				}
			});
		}
	}

	if (frm.weight_bridge_scale_lifecycle_bound) {
		return;
	}

	frm.weight_bridge_scale_lifecycle_bound = true;
}

function render_scale_toolbar(frm) {
	const controller = ensure_serial_scale_controller(frm);
	const connected = controller?.isConnected();
	const busy = ["connecting", "selecting", "disconnecting"].includes(controller?.status);
	const label = connected ? __("Disconnect Scale") : __("Connect Scale");
	const click_handler = connected ? () => close_scale_connection(frm) : () => connect_scale_with_prompt(frm);

	if (!frm.weight_bridge_scale_button || !$.contains(document, frm.weight_bridge_scale_button[0])) {
		frm.weight_bridge_scale_button = frm.add_custom_button(label, click_handler);
		frm.weight_bridge_scale_button.attr("data-weight-bridge-scale-toolbar", "1");
	} else {
		frm.weight_bridge_scale_button.text(label).off("click").on("click", click_handler);
	}

	frm.weight_bridge_scale_button
		.toggleClass("btn-primary", !connected)
		.toggleClass("btn-default", connected)
		.prop("disabled", Boolean(busy));
}

async function connect_authorized_scale(frm) {
	const controller = ensure_serial_scale_controller(frm);
	if (!controller?.isSupported()) {
		return;
	}

	try {
		const connected = await controller.openAuthorized({ baudRate: get_scale_baud_rate(frm) });
		if (!connected && !frm.weight_bridge_no_authorized_port_alerted) {
			frm.weight_bridge_no_authorized_port_alerted = true;
			frappe.show_alert({
				message: __("No authorized scale port found. Click Connect Scale and select COM3."),
				indicator: "orange",
			});
		}
	} catch (error) {
		frappe.show_alert({
			message: __("Could not auto-connect scale: {0}", [error.message || String(error)]),
			indicator: "orange",
		});
	}

	update_scale_status(frm);
}

async function connect_scale_with_prompt(frm) {
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
		await controller.open({ baudRate: get_scale_baud_rate(frm) });
		frappe.show_alert({ message: __("Scale connected."), indicator: "green" });
	} catch (error) {
		if (error.name === "NotFoundError") {
			frappe.show_alert({ message: __("No serial port was selected."), indicator: "orange" });
			return;
		}

		frappe.msgprint({
			title: __("Could Not Connect Scale"),
			message: error.message || String(error),
			indicator: "red",
		});
	}

	update_scale_status(frm);
}

async function close_scale_connection(frm, options = {}) {
	const controller = ensure_serial_scale_controller(frm);
	if (!controller) {
		return;
	}

	await controller.close();
	if (!options.silent) {
		frappe.show_alert({ message: __("Scale disconnected."), indicator: "blue" });
	}
	update_scale_status(frm);
}

function handle_scale_reading(frm, reading) {
	const serial_api = normalize_serial_scale_api(window.weight_bridge?.SerialScale);
	if (!serial_api) {
		return;
	}

	const stable_result = serial_api.updateStableReading(
		reading,
		frm.weight_bridge_stable_state,
		get_scale_settings(frm)
	);
	frm.weight_bridge_latest_stable_result = stable_result;

	if (stable_result.stable) {
		capture_stable_scale_weight(frm, stable_result.reading);
	}

	update_scale_status(frm);
	render_weight_capture_buttons(frm);
}

async function capture_stable_scale_weight(frm, reading) {
	if (frm.weight_bridge_capturing_scale || is_weight_capture_locked(frm)) {
		return;
	}

	const fieldname = get_next_weight_fieldname(frm);
	if (!fieldname) {
		return;
	}

	await capture_scale_weight(frm, fieldname, reading, { source: "stable" });
}

async function capture_latest_scale_weight(frm, fieldname) {
	if (!is_manual_weight_capture_allowed(frm, fieldname)) {
		return;
	}

	const stable_reading = get_latest_stable_reading(frm);
	if (!stable_reading) {
		frappe.show_alert({
			message: __("Wait for a stable scale reading before setting the weight."),
			indicator: "orange",
		});
		return;
	}

	await capture_scale_weight(frm, fieldname, stable_reading, { source: "manual" });
}

async function capture_scale_weight(frm, fieldname, reading, options = {}) {
	if (frm.weight_bridge_capturing_scale || is_weight_capture_locked(frm)) {
		return;
	}

	const weight = Number(reading?.weight);
	if (!Number.isFinite(weight) || weight <= 0) {
		return;
	}
	if (fieldname === "second_weight" && is_duplicate_second_weight_reading(frm, weight)) {
		return;
	}

	frm.weight_bridge_capturing_scale = true;
	try {
		const datetime_fieldname = fieldname === "first_weight" ? "first_weight_datetime" : "second_weight_datetime";
		await frm.set_value(fieldname, weight);
		await frm.set_value(datetime_fieldname, get_now_datetime_value());
		if (fieldname === "first_weight") {
			frm.weight_bridge_first_weight_captured_this_session = true;
		} else {
			frm.weight_bridge_first_weight_captured_this_session = false;
		}
		set_dynamic_weight_labels(frm);
		set_order_reference_visibility(frm);
		render_weight_capture_buttons(frm);
		frappe.show_alert({
			message: __("{0} {1} from stable scale reading: {2} Kg. Save the ticket.", [
				get_field_label(frm, fieldname),
				options.source === "manual" ? __("set") : __("captured"),
				format_number(weight),
			]),
			indicator: "green",
		});
	} finally {
		frm.weight_bridge_capturing_scale = false;
	}
}

function get_latest_stable_reading(frm) {
	const stable_result = frm.weight_bridge_latest_stable_result;
	if (stable_result?.stable && stable_result.reading) {
		return stable_result.reading;
	}

	return null;
}

function is_weight_capture_locked(frm) {
	return frm.doc.docstatus !== 0 || (frm.doc.name && !frm.doc.__islocal && !frm.doc.name.startsWith("WB-"));
}

function get_next_weight_fieldname(frm) {
	if (flt(frm.doc.first_weight) <= 0) {
		return "first_weight";
	}
	if (
		flt(frm.doc.second_weight) <= 0 &&
		!frm.doc.__islocal &&
		frm.doc.name &&
		frm.doc.name.startsWith("WB-") &&
		!frm.weight_bridge_first_weight_captured_this_session
	) {
		return "second_weight";
	}

	return null;
}

function is_manual_weight_capture_allowed(frm, fieldname) {
	if (is_weight_capture_locked(frm)) {
		return false;
	}
	if (fieldname === "first_weight") {
		return Boolean(frm.doc.__islocal);
	}
	if (fieldname === "second_weight") {
		return Boolean(
			!frm.doc.__islocal &&
				frm.doc.name &&
				frm.doc.name.startsWith("WB-") &&
				flt(frm.doc.first_weight) > 0
		);
	}

	return false;
}

function is_duplicate_second_weight_reading(frm, weight) {
	const first_weight = flt(frm.doc.first_weight);
	if (first_weight <= 0) {
		return false;
	}

	const settings = get_scale_settings(frm);
	const min_net_weight = Number(settings.min_net_weight_kg);
	const required_difference = Math.max(
		get_stability_tolerance(settings),
		Number.isFinite(min_net_weight) && min_net_weight > 0 ? min_net_weight : 0
	);

	return Math.abs(Number(weight) - first_weight) <= required_difference;
}

function set_dynamic_weight_labels(frm) {
	const direction = get_ticket_direction(frm);
	let first_label = __("First Scale Weight (Kg)");
	let second_label = __("Second Scale Weight (Kg)");

	if (direction === "IN") {
		first_label = __("Gross Weight at Entry (Kg)");
		second_label = __("Vehicle/Tare Weight at Exit (Kg)");
	} else if (direction === "OUT") {
		first_label = __("Vehicle/Tare Weight at Entry (Kg)");
		second_label = __("Gross Weight at Exit (Kg)");
	}

	frm.set_df_property("first_weight", "label", first_label);
	frm.set_df_property("second_weight", "label", second_label);
	update_weight_capture_button_labels(frm, first_label, second_label);
}

function update_weight_capture_button_labels(frm, first_label, second_label) {
	const first_action = flt(frm.doc.first_weight) > 0 ? __("Update") : __("Set");
	const second_action = flt(frm.doc.second_weight) > 0 ? __("Update") : __("Set");
	frm.set_df_property("set_first_weight_button", "label", __("{0} {1}", [first_action, first_label]));
	frm.set_df_property("set_second_weight_button", "label", __("{0} {1}", [second_action, second_label]));
}

function render_weight_capture_buttons(frm) {
	const has_stable_reading = Boolean(get_latest_stable_reading(frm));
	update_weight_capture_button("set_first_weight_button", frm, has_stable_reading);
	update_weight_capture_button("set_second_weight_button", frm, has_stable_reading);
}

function update_weight_capture_button(button_fieldname, frm, has_stable_reading) {
	const target_fieldname = button_fieldname === "set_first_weight_button" ? "first_weight" : "second_weight";
	const enabled = has_stable_reading && is_manual_weight_capture_allowed(frm, target_fieldname);

	if (frm.toggle_display) {
		frm.toggle_display(button_fieldname, true);
	}
	if (frm.toggle_enable) {
		frm.toggle_enable(button_fieldname, enabled);
	}

	const button = frm.fields_dict[button_fieldname]?.$wrapper?.find("button");
	if (button?.prop) {
		button.prop("disabled", !enabled);
	}
}

function update_scale_status(frm) {
	const controller = ensure_serial_scale_controller(frm);
	const latest_reading = controller?.getLatestReading();
	const stable_result = frm.weight_bridge_latest_stable_result;
	const labels = {
		connecting: __("Scale connecting"),
		connected: __("Scale connected"),
		disconnected: __("Scale disconnected"),
		disconnecting: __("Scale disconnecting"),
		error: __("Scale error"),
		not_authorized: __("Scale not authorized"),
		reading: __("Scale reading"),
		selecting: __("Select scale port"),
	};
	const label = labels[controller?.status] || __("Scale unavailable");
	const color = get_scale_status_color(controller, stable_result);
	const weight_text = latest_reading ? ` ${format_serial_weight(latest_reading)}` : "";
	const stable_text = stable_result?.stable ? ` ${__("stable")}` : "";
	const status_code = latest_reading?.statusCode ? ` ${__("status")} ${escape_html(latest_reading.statusCode)}` : "";
	const detail_text =
		controller?.status === "error" && controller.lastStatusDetail
			? ` ${escape_html(controller.lastStatusDetail)}`
			: "";

	show_scale_status(frm, `${label}${weight_text}${stable_text}${status_code}${detail_text}`, color);
	render_scale_toolbar(frm);
	render_weight_capture_buttons(frm);
}

function get_scale_status_color(controller, stable_result) {
	if (!controller?.isSupported() || ["error", "not_authorized"].includes(controller?.status)) {
		return "orange";
	}
	if (controller?.isConnected() && stable_result?.stable) {
		return "green";
	}
	if (controller?.isConnected()) {
		return "blue";
	}
	return "gray";
}

function show_scale_status(frm, label, color) {
	const message_container = frm.layout?.message;
	if (!message_container?.length) {
		return;
	}

	message_container
		.find("[data-weight-bridge-scale-message], .form-message")
		.filter(function () {
			const text = $(this).text().trim();
			return $(this).is("[data-weight-bridge-scale-message]") || /\bscale\b/i.test(text);
		})
		.remove();

	const block_color = ["yellow", "blue", "red", "green", "orange"].includes(color) ? color : "blue";
	$(
		`<div class="form-message ${block_color} weight-bridge-scale-message" data-weight-bridge-scale-message>
			<span class="indicator ${color}">${escape_html(label)}</span>
		</div>`
	).prependTo(message_container);
	message_container.removeClass("hidden");
}

function get_scale_baud_rate(frm) {
	const baud_rate = Number(get_scale_settings(frm).serial_baud_rate);
	return Number.isFinite(baud_rate) && baud_rate > 0
		? baud_rate
		: WEIGHT_BRIDGE_DEFAULT_SCALE_SETTINGS.serial_baud_rate;
}

function get_scale_settings(frm) {
	return frm.weight_bridge_scale_settings || WEIGHT_BRIDGE_DEFAULT_SCALE_SETTINGS;
}

function create_stable_reading_state() {
	return {
		lastWeight: null,
		stableCount: 0,
		latestStableReading: null,
	};
}

function update_stable_reading(reading, state, options) {
	const stable_state = state || create_stable_reading_state();
	const settings = {
		...WEIGHT_BRIDGE_DEFAULT_SCALE_SETTINGS,
		...(options || {}),
	};
	const weight = Number(reading?.weight);
	const stable_codes = parse_stable_status_codes(settings.stable_status_codes);

	if (!Number.isFinite(weight) || !is_stable_status_code(reading?.statusCode, stable_codes)) {
		stable_state.stableCount = 0;
		stable_state.latestStableReading = null;
		return {
			stable: false,
			stableCount: stable_state.stableCount,
			requiredStableCount: get_stable_reading_count(settings),
			reading,
		};
	}

	if (
		stable_state.lastWeight !== null &&
		Math.abs(weight - stable_state.lastWeight) <= get_stability_tolerance(settings)
	) {
		stable_state.stableCount += 1;
	} else {
		stable_state.lastWeight = weight;
		stable_state.stableCount = 1;
	}

	const required_count = get_stable_reading_count(settings);
	const stable = stable_state.stableCount >= required_count;
	stable_state.latestStableReading = stable ? reading : null;

	return {
		stable,
		stableCount: stable_state.stableCount,
		requiredStableCount: required_count,
		reading,
	};
}

function parse_stable_status_codes(value) {
	if (value === undefined || value === null) {
		return ["A"];
	}

	return String(value)
		.split(/[,\s]+/)
		.map((code) => code.trim().toUpperCase())
		.filter(Boolean);
}

function is_stable_status_code(status_code, stable_codes) {
	if (!stable_codes.length) {
		return true;
	}

	return stable_codes.includes(String(status_code || "").trim().toUpperCase());
}

function get_stable_reading_count(settings) {
	const count = Number(settings.stable_reading_count);
	return Number.isFinite(count) && count > 0 ? Math.ceil(count) : 3;
}

function get_stability_tolerance(settings) {
	const tolerance = Number(settings.stability_tolerance_kg);
	return Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0.001;
}

function load_scale_settings(frm) {
	if (!window.weight_bridge_scale_settings_promise) {
		window.weight_bridge_scale_settings_promise = frappe.db
			.get_doc("Weight Bridge Settings", "Weight Bridge Settings")
			.then((settings) => ({
				...WEIGHT_BRIDGE_DEFAULT_SCALE_SETTINGS,
				...settings,
			}))
			.catch(() => WEIGHT_BRIDGE_DEFAULT_SCALE_SETTINGS);
	}

	return window.weight_bridge_scale_settings_promise.then((settings) => {
		frm.weight_bridge_scale_settings = settings;
		return settings;
	});
}

function format_serial_weight(reading) {
	if (!reading || reading.weight === null || reading.weight === undefined) {
		return __("no reading");
	}

	return `${format_number(reading.weight)} Kg`;
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

function get_now_datetime_value() {
	if (frappe.datetime?.now_datetime) {
		return frappe.datetime.now_datetime();
	}

	return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function is_empty_value(value) {
	return value === undefined || value === null || value === "";
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
