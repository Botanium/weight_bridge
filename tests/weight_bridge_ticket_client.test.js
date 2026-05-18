const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TICKET_SCRIPT_PATH = path.join(
	__dirname,
	"../weight_bridge/weight_bridge/doctype/weight_bridge_ticket/weight_bridge_ticket.js"
);

function createChain(label = "") {
	const chain = {
		0: {},
		length: 1,
		attrs: {},
		classes: {},
		props: {},
		addClass() {
			return this;
		},
		appendTo() {
			return this;
		},
		attr(name, value) {
			if (arguments.length === 1) {
				return this.attrs[name];
			}
			this.attrs[name] = value;
			return this;
		},
		filter() {
			return this;
		},
		find() {
			return this;
		},
		is() {
			return false;
		},
		off() {
			return this;
		},
		on() {
			return this;
		},
		prependTo() {
			return this;
		},
		prop(name, value) {
			if (arguments.length === 1) {
				return this.props[name];
			}
			this.props[name] = value;
			return this;
		},
		remove() {
			return this;
		},
		removeClass() {
			return this;
		},
		text(value) {
			if (arguments.length) {
				label = value;
				return this;
			}
			return label;
		},
		toggleClass(className, enabled) {
			this.classes[className] = enabled;
			return this;
		},
	};

	return chain;
}

function flushPromises() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadTicketScript(serialApi) {
	const ticketScript = fs.readFileSync(TICKET_SCRIPT_PATH, "utf8");
	const context = {
		alerts: [],
		msgprints: [],
		console,
		window: {
			weight_bridge: {
				SerialScale: serialApi,
			},
		},
		document: {},
		locals: {},
		$: Object.assign(() => createChain(), {
			contains() {
				return false;
			},
		}),
		__(text, values) {
			if (!values) {
				return text;
			}
			return text.replace(/\{(\d+)\}/g, (_match, index) => values[Number(index)] ?? "");
		},
		flt(value) {
			return Number(value || 0);
		},
		frappe: {
			datetime: {
				now_datetime() {
					return "2099-01-01 10:00:00";
				},
			},
			db: {
				get_doc() {
					return Promise.resolve({
						auto_connect_scale: 0,
						min_net_weight_kg: 1,
						serial_baud_rate: 9600,
						stable_reading_count: 1,
						stable_status_codes: "A",
						stability_tolerance_kg: 0.001,
					});
				},
			},
			get_route() {
				return ["Form", "Weight Bridge Ticket", "new-weight-bridge-ticket"];
			},
			router: {
				on() {},
			},
			set_route(...args) {
				context.route = args;
			},
			show_alert(alert) {
				context.alerts.push(alert);
			},
			msgprint(message) {
				context.msgprints.push(message);
			},
			ui: {
				form: {
					on(doctype, handlers) {
						context.handlers = handlers;
					},
				},
			},
		},
	};

	vm.runInNewContext(ticketScript, context);
	return context;
}

function createFrm(doc = {}) {
	const submitButton = createChain("Submit");
	return {
		doctype: "Weight Bridge Ticket",
		doc: {
			doctype: "Weight Bridge Ticket",
			docstatus: 0,
			__islocal: 1,
			name: "new-weight-bridge-ticket",
			...doc,
		},
		add_custom_button() {
			return createChain();
		},
		fields_dict: {
			first_weight: { df: { label: "First Scale Weight (Kg)" } },
			second_weight: { df: { label: "Second Scale Weight (Kg)" } },
			set_first_weight_button: { $wrapper: createChain(), df: { label: "Set" } },
			set_second_weight_button: { $wrapper: createChain(), df: { label: "Set" } },
		},
		layout: {
			message: createChain(),
		},
		page: {
			btn_primary: submitButton,
		},
		set_df_property(fieldname, property, value) {
			this.fields_dict[fieldname] = this.fields_dict[fieldname] || { df: {} };
			this.fields_dict[fieldname].df[property] = value;
		},
		set_query(fieldname, query) {
			this.queries = this.queries || {};
			this.queries[fieldname] = query;
		},
		set_value(fieldname, value) {
			this.doc[fieldname] = value;
			return Promise.resolve();
		},
		toggle_display() {},
		toggle_enable() {},
	};
}

function createFakeSerialApi() {
	const api = {
		controllerOptions: null,
		resetCount: 0,
		controller: {
			status: "reading",
			getLatestReading() {
				return api.latestReading || null;
			},
			isConnected() {
				return true;
			},
			isSupported() {
				return true;
			},
			async openAuthorized() {
				return false;
			},
		},
		createController(options) {
			api.controllerOptions = options;
			return api.controller;
		},
		createStableReadingState() {
			api.resetCount += 1;
			return {};
		},
		updateStableReading(reading) {
			api.latestReading = reading;
			return {
				stable: true,
				stableCount: 1,
				requiredStableCount: 1,
				reading,
			};
		},
	};

	return api;
}

test("ticket form tolerates older serial asset without stable-reading helpers", () => {
	const oldSerialApi = {
		createController() {
			return {
				status: "disconnected",
				getLatestReading() {
					return null;
				},
				isConnected() {
					return false;
				},
				isSupported() {
					return false;
				},
			};
		},
	};
	const context = loadTicketScript(oldSerialApi);
	const frm = createFrm();

	assert.doesNotThrow(() => context.handlers.refresh(frm));
	assert.equal(typeof oldSerialApi.createStableReadingState, "function");
	assert.equal(typeof oldSerialApi.updateStableReading, "function");
	assert.equal(frm.doc.first_weight, 0);
	assert.equal(frm.doc.second_weight, 0);
	assert.equal(frm.doc.first_weight_datetime, "2099-01-01 10:00:00");
});

test("ticket form filters purchase and sales orders by selected origin party", () => {
	const context = loadTicketScript(createFakeSerialApi());
	const frm = createFrm({
		origin_type: "Customer",
		origin: "_Test Customer 1",
	});

	context.handlers.setup(frm);

	assert.deepEqual(JSON.parse(JSON.stringify(frm.queries.sales_order().filters)), {
		docstatus: 1,
		status: ["not in", ["Cancelled", "Closed"]],
		customer: "_Test Customer 1",
	});

	frm.doc.origin_type = "Supplier";
	frm.doc.origin = "_Test Supplier";

	assert.deepEqual(JSON.parse(JSON.stringify(frm.queries.purchase_order().filters)), {
		docstatus: 1,
		status: ["not in", ["Cancelled", "Closed"]],
		supplier: "_Test Supplier",
	});
});

test("ticket form clears PO and SO when origin changes", () => {
	const context = loadTicketScript(createFakeSerialApi());
	const frm = createFrm({
		purchase_order: "PUR-ORD-TEST",
		sales_order: "SAL-ORD-TEST",
	});

	context.handlers.origin(frm);

	assert.equal(frm.doc.purchase_order, null);
	assert.equal(frm.doc.sales_order, null);
});

test("ticket form captures second scale weight after first weight is saved", async () => {
	const serialApi = createFakeSerialApi();
	const context = loadTicketScript(serialApi);
	const frm = createFrm({
		first_weight_datetime: undefined,
		first_weight: 0,
		second_weight: 0,
	});

	context.handlers.refresh(frm);

	serialApi.controllerOptions.onReading({ weight: 18610, statusCode: "A" });
	await flushPromises();

	assert.equal(frm.doc.first_weight, 18610);
	assert.equal(frm.doc.first_weight_datetime, "2099-01-01 10:00:00");
	assert.equal(frm.doc.second_weight, 0);
	assert.equal(frm.weight_bridge_first_weight_captured_this_session, true);

	context.handlers.before_save(frm);
	frm.doc.__islocal = 0;
	frm.doc.name = "WB-260510-04";
	context.handlers.after_save(frm);

	assert.equal(frm.weight_bridge_first_weight_captured_this_session, false);
	assert.ok(serialApi.resetCount >= 2);

	serialApi.controllerOptions.onReading({ weight: 18610, statusCode: "A" });
	await flushPromises();

	assert.equal(frm.doc.second_weight, 0);
	assert.equal(frm.doc.second_weight_datetime, undefined);

	serialApi.controllerOptions.onReading({ weight: 46190, statusCode: "A" });
	await flushPromises();

	assert.equal(frm.doc.second_weight, 46190);
	assert.equal(frm.doc.second_weight_datetime, "2099-01-01 10:00:00");
	assert.equal(frm.weight_bridge_first_weight_captured_this_session, false);
});

test("ticket form Set buttons update the active weighing stage from the latest stable reading", async () => {
	const serialApi = createFakeSerialApi();
	const context = loadTicketScript(serialApi);
	const frm = createFrm({
		first_weight_datetime: undefined,
		first_weight: 0,
		second_weight: 0,
	});

	context.handlers.refresh(frm);

	serialApi.controllerOptions.onReading({ weight: 10000, statusCode: "A" });
	await flushPromises();
	assert.equal(frm.doc.first_weight, 10000);

	serialApi.controllerOptions.onReading({ weight: 9500, statusCode: "A" });
	await flushPromises();
	await context.capture_latest_scale_weight(frm, "first_weight");
	await flushPromises();

	assert.equal(frm.doc.first_weight, 9500);
	assert.equal(frm.doc.first_weight_datetime, "2099-01-01 10:00:00");

	context.handlers.before_save(frm);
	frm.doc.__islocal = 0;
	frm.doc.name = "WB-260511-01";
	context.handlers.after_save(frm);

	serialApi.controllerOptions.onReading({ weight: 42000, statusCode: "A" });
	await flushPromises();
	await context.capture_latest_scale_weight(frm, "second_weight");
	await flushPromises();

	assert.equal(frm.doc.second_weight, 42000);
	assert.equal(frm.doc.second_weight_datetime, "2099-01-01 10:00:00");

	serialApi.controllerOptions.onReading({ weight: 42125, statusCode: "A" });
	await flushPromises();
	await context.capture_latest_scale_weight(frm, "second_weight");
	await flushPromises();

	assert.equal(frm.doc.second_weight, 42125);
});

test("ticket form blocks submitting provisional WB tickets", () => {
	const serialApi = createFakeSerialApi();
	const context = loadTicketScript(serialApi);
	const frm = createFrm({
		__islocal: 0,
		name: "WB-260518-01",
		first_weight_datetime: "2099-01-01 10:00:00",
		first_weight: 41890,
		second_weight: 0,
		ticket_status: "Pending Second Weight",
	});

	context.handlers.refresh(frm);
	context.handlers.before_submit(frm);

	assert.equal(context.frappe.validated, false);
	assert.equal(frm.page.btn_primary.props.disabled, true);
	assert.equal(frm.page.btn_primary.classes.disabled, true);
	assert.match(frm.page.btn_primary.attrs.title, /second scale weight/i);
	assert.equal(context.msgprints.length, 1);
});

test("ticket form allows submit only after final IN or OUT naming", () => {
	const serialApi = createFakeSerialApi();
	const context = loadTicketScript(serialApi);
	const frm = createFrm({
		__islocal: 0,
		name: "IN-260518-01",
		first_weight_datetime: "2099-01-01 10:00:00",
		second_weight_datetime: "2099-01-01 12:00:00",
		first_weight: 41890,
		second_weight: 14000,
		direction: "IN",
		ticket_status: "Finalized",
	});

	context.handlers.refresh(frm);
	context.handlers.before_submit(frm);

	assert.notEqual(context.frappe.validated, false);
	assert.equal(frm.page.btn_primary.props.disabled, false);
	assert.equal(frm.page.btn_primary.classes.disabled, false);
});
