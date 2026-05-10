const test = require("node:test");
const assert = require("node:assert/strict");

const { SerialScaleController } = require("../weight_bridge/public/js/serial_scale.js");

function createFakePort(chunks, options = {}) {
	const encoder = new TextEncoder();
	const port = {
		closed: false,
		openOptions: null,
		async open(openOptions) {
			this.openOptions = openOptions;
			this.readable = new ReadableStream({
				start(controller) {
					if (options.keepOpen) {
						port.streamController = controller;
						return;
					}

					for (const chunk of chunks) {
						controller.enqueue(encoder.encode(chunk));
					}
					controller.close();
				},
				cancel() {
					port.cancelled = true;
				},
			});
		},
		async close() {
			this.closed = true;
		},
	};

	return port;
}

test("opens a Web Serial port and reads scale data end to end with a fake stream", async () => {
	const fakePort = createFakePort(["   20\r", "C ", "   90\r", "A "]);
	const readings = [];
	const statuses = [];
	const serial = {
		async requestPort() {
			return fakePort;
		},
	};
	const controller = new SerialScaleController({
		serial,
		TextDecoderStream,
		onReading: (reading) => readings.push(reading),
		onStatusChange: (status) => statuses.push(status.status),
	});

	await controller.open({ baudRate: 4800 });
	await controller.readLoopPromise;

	assert.equal(fakePort.openOptions.baudRate, 4800);
	assert.equal(readings.at(-1).weight, 90);
	assert.equal(readings.at(-1).statusCode, "A");
	assert.equal(controller.getLatestReading().weight, 90);
	assert.ok(statuses.includes("selecting"));
	assert.ok(statuses.includes("connected"));
	assert.ok(statuses.includes("reading"));
	assert.equal(statuses.at(-1), "disconnected");
});

test("auto-opens a previously authorized Web Serial port without prompting", async () => {
	const fakePort = createFakePort(["   70\r", "A "]);
	let requestedPort = false;
	const serial = {
		async getPorts() {
			return [fakePort];
		},
		async requestPort() {
			requestedPort = true;
			return fakePort;
		},
	};
	const controller = new SerialScaleController({
		serial,
		TextDecoderStream,
	});

	const connected = await controller.openAuthorized({ baudRate: 9600 });
	await controller.readLoopPromise;

	assert.equal(connected, true);
	assert.equal(requestedPort, false);
	assert.equal(fakePort.openOptions.baudRate, 9600);
	assert.equal(controller.getLatestReading().weight, 70);
});

test("reports not authorized when no saved serial port permission exists", async () => {
	const statuses = [];
	const serial = {
		async getPorts() {
			return [];
		},
	};
	const controller = new SerialScaleController({
		serial,
		TextDecoderStream,
		onStatusChange: (status) => statuses.push(status.status),
	});

	const connected = await controller.openAuthorized();

	assert.equal(connected, false);
	assert.equal(statuses.at(-1), "not_authorized");
});

test("closes an open Web Serial port cleanly", async () => {
	const fakePort = createFakePort([], { keepOpen: true });
	const statuses = [];
	const serial = {
		async requestPort() {
			return fakePort;
		},
	};
	const controller = new SerialScaleController({
		serial,
		TextDecoderStream,
		onStatusChange: (status) => statuses.push(status.status),
	});

	await controller.open({ baudRate: 9600 });
	await controller.close();

	assert.equal(fakePort.cancelled, true);
	assert.equal(fakePort.closed, true);
	assert.equal(statuses.at(-1), "disconnected");
});
