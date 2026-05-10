const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createChain() {
	const chain = {
		0: {},
		length: 1,
		addClass() {
			return this;
		},
		appendTo() {
			return this;
		},
		attr() {
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
		prop() {
			return this;
		},
		remove() {
			return this;
		},
		removeClass() {
			return this;
		},
		text() {
			return "";
		},
		toggleClass() {
			return this;
		},
	};

	return chain;
}

test("ticket form tolerates older serial asset without stable-reading helpers", () => {
	const ticketScript = fs.readFileSync(
		path.join(
			__dirname,
			"../weight_bridge/weight_bridge/doctype/weight_bridge_ticket/weight_bridge_ticket.js"
		),
		"utf8"
	);
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
	const context = {
		console,
		window: {
			weight_bridge: {
				SerialScale: oldSerialApi,
			},
		},
		document: {},
		locals: {},
		$: Object.assign(() => createChain(), {
			contains() {
				return false;
			},
		}),
		__(text) {
			return text;
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
					return Promise.reject(new Error("not needed"));
				},
			},
			get_route() {
				return ["Form", "Weight Bridge Ticket", "new-weight-bridge-ticket"];
			},
			router: {
				on() {},
			},
			set_route() {},
			show_alert() {},
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

	const frm = {
		doc: {
			__islocal: 1,
			name: "new-weight-bridge-ticket",
		},
		add_custom_button() {
			return createChain();
		},
		fields_dict: {},
		layout: {
			message: createChain(),
		},
		set_df_property() {},
		set_value(fieldname, value) {
			this.doc[fieldname] = value;
			return Promise.resolve();
		},
		toggle_display() {},
	};

	assert.doesNotThrow(() => context.handlers.refresh(frm));
	assert.equal(typeof oldSerialApi.createStableReadingState, "function");
	assert.equal(typeof oldSerialApi.updateStableReading, "function");
	assert.equal(frm.doc.first_weight, 0);
	assert.equal(frm.doc.second_weight, 0);
	assert.equal(frm.doc.first_weight_datetime, "2099-01-01 10:00:00");
});
