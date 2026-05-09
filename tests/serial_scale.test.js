const test = require("node:test");
const assert = require("node:assert/strict");

const serialScale = require("../weight_bridge/public/js/serial_scale.js");

test("parses split scale chunks with numeric values and status codes", () => {
	const state = serialScale.createParserState();

	serialScale.parseScaleChunk("    0\r", state);
	let reading = serialScale.parseScaleChunk("A ", state);

	assert.equal(reading.weight, 0);
	assert.equal(reading.statusCode, "A");

	serialScale.parseScaleChunk("   20\r", state);
	serialScale.parseScaleChunk("C", state);
	serialScale.parseScaleChunk("    90\r", state);
	reading = serialScale.parseScaleChunk("A ", state);

	assert.equal(reading.weight, 90);
	assert.equal(reading.statusCode, "A");
});

test("parses fragmented numeric readings", () => {
	const state = serialScale.createParserState();

	serialScale.parseScaleChunk("  ", state);
	serialScale.parseScaleChunk("9", state);
	const reading = serialScale.parseScaleChunk("0\r", state);

	assert.equal(reading.weight, 90);
});

test("normalizes decimal and thousands separators", () => {
	assert.equal(serialScale.parseNumber("90.5"), 90.5);
	assert.equal(serialScale.parseNumber("90,5"), 90.5);
	assert.equal(serialScale.parseNumber("1,000"), 1000);
	assert.equal(serialScale.parseNumber("1,000.5"), 1000.5);
});

test("resolves serial open options with conservative defaults", () => {
	assert.deepEqual(serialScale.resolveOpenOptions({ baudRate: 4800 }), {
		baudRate: 4800,
		dataBits: 8,
		stopBits: 1,
		parity: "none",
		flowControl: "none",
	});

	assert.equal(serialScale.resolveOpenOptions({ baudRate: 0 }).baudRate, serialScale.DEFAULT_BAUD_RATE);
});
