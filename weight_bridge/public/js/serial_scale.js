(function (root, factory) {
	const api = factory(root);

	if (typeof module === "object" && module.exports) {
		module.exports = api;
	}

	if (root) {
		root.weight_bridge = root.weight_bridge || {};
		root.weight_bridge.SerialScale = api;
	}
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
	const DEFAULT_BAUD_RATE = 9600;
	const DEFAULT_DATA_BITS = 8;
	const DEFAULT_STOP_BITS = 1;
	const DEFAULT_PARITY = "none";
	const DEFAULT_FLOW_CONTROL = "none";
	const MAX_BUFFER_LENGTH = 256;

	function createParserState() {
		return {
			buffer: "",
			lastWeight: null,
			lastStatusCode: null,
			lastChunk: "",
		};
	}

	function decodeChunk(chunk) {
		if (chunk === undefined || chunk === null) {
			return "";
		}
		if (typeof chunk === "string") {
			return chunk;
		}
		if (typeof TextDecoder !== "undefined") {
			return new TextDecoder().decode(chunk);
		}
		if (typeof Buffer !== "undefined") {
			return Buffer.from(chunk).toString("utf8");
		}

		return String(chunk);
	}

	function normalizeNumberText(value) {
		const text = String(value || "").trim();
		if (!text) {
			return null;
		}

		if (text.includes(",") && text.includes(".")) {
			return text.replace(/,/g, "");
		}

		if (text.includes(",")) {
			const [whole, fraction] = text.split(",");
			if (fraction && fraction.length === 3 && whole.length > 0) {
				return `${whole}${fraction}`;
			}
			return `${whole}.${fraction || ""}`;
		}

		return text;
	}

	function parseNumber(value) {
		const normalized = normalizeNumberText(value);
		const numberValue = Number(normalized);
		return Number.isFinite(numberValue) ? numberValue : null;
	}

	function parseScaleChunk(chunk, state) {
		const parserState = state || createParserState();
		const text = decodeChunk(chunk);
		parserState.lastChunk = text;
		parserState.buffer = `${parserState.buffer}${text}`.slice(-MAX_BUFFER_LENGTH);

		const numberMatches = parserState.buffer.match(/[-+]?\d+(?:[.,]\d+)?/g);
		if (numberMatches && numberMatches.length) {
			const parsedWeight = parseNumber(numberMatches[numberMatches.length - 1]);
			if (parsedWeight !== null) {
				parserState.lastWeight = parsedWeight;
			}
		}

		const statusMatches = Array.from(parserState.buffer.matchAll(/(?:^|[\s\r\n])([A-Za-z])(?:[\s\r\n]|$)/g));
		if (statusMatches.length) {
			parserState.lastStatusCode = statusMatches[statusMatches.length - 1][1].toUpperCase();
		}

		return {
			weight: parserState.lastWeight,
			statusCode: parserState.lastStatusCode,
			rawChunk: text,
			rawBuffer: parserState.buffer,
			receivedAt: new Date().toISOString(),
		};
	}

	function resolveOpenOptions(options) {
		const serialOptions = options || {};
		const baudRate = Number(serialOptions.baudRate || DEFAULT_BAUD_RATE);

		return {
			baudRate: Number.isFinite(baudRate) && baudRate > 0 ? baudRate : DEFAULT_BAUD_RATE,
			dataBits: Number(serialOptions.dataBits || DEFAULT_DATA_BITS),
			stopBits: Number(serialOptions.stopBits || DEFAULT_STOP_BITS),
			parity: serialOptions.parity || DEFAULT_PARITY,
			flowControl: serialOptions.flowControl || DEFAULT_FLOW_CONTROL,
		};
	}

	class SerialScaleController {
		constructor(options) {
			const controllerOptions = options || {};
			this.serial = controllerOptions.serial || root?.navigator?.serial || null;
			this.TextDecoderStream = controllerOptions.TextDecoderStream || root?.TextDecoderStream || null;
			this.onReading = controllerOptions.onReading || function () {};
			this.onStatusChange = controllerOptions.onStatusChange || function () {};
			this.onError = controllerOptions.onError || function () {};
			this.parserState = createParserState();
			this.status = "disconnected";
			this.port = null;
			this.reader = null;
			this.decoder = null;
			this.readableStreamClosed = null;
			this.readLoopPromise = null;
			this.keepReading = false;
			this.latestReading = null;
		}

		isSupported() {
			return Boolean(this.serial && this.TextDecoderStream);
		}

		isConnected() {
			return this.status === "connected" || this.status === "reading";
		}

		getLatestReading() {
			return this.latestReading;
		}

		setStatus(status, detail) {
			this.status = status;
			this.onStatusChange({
				status,
				detail: detail || null,
				reading: this.latestReading,
			});
		}

		async open(options) {
			if (!this.isSupported()) {
				throw new Error("Web Serial is not supported in this browser. Use Chrome or Edge over HTTPS.");
			}

			if (this.port) {
				await this.close();
			}

			this.setStatus("selecting");
			this.port = await this.serial.requestPort();
			await this.port.open(resolveOpenOptions(options));

			this.decoder = new this.TextDecoderStream();
			this.readableStreamClosed = this.port.readable.pipeTo(this.decoder.writable).catch((error) => {
				if (this.keepReading) {
					this.onError(error);
				}
			});
			this.reader = this.decoder.readable.getReader();
			this.keepReading = true;
			this.setStatus("connected");
			this.readLoopPromise = this.readLoop();

			return this;
		}

		async readLoop() {
			try {
				while (this.keepReading && this.reader) {
					const { value, done } = await this.reader.read();
					if (done) {
						break;
					}

					this.setStatus("reading");
					const reading = parseScaleChunk(value, this.parserState);
					this.latestReading = reading;
					this.onReading(reading);
				}
			} catch (error) {
				if (this.keepReading) {
					this.setStatus("error", error.message || String(error));
					this.onError(error);
				}
			} finally {
				if (this.reader) {
					try {
						this.reader.releaseLock();
					} catch (error) {
						// The reader may already be released after cancellation.
					}
				}
				this.reader = null;
				if (this.keepReading) {
					this.keepReading = false;
					this.setStatus("disconnected");
				}
			}
		}

		async close() {
			this.keepReading = false;
			this.setStatus("disconnecting");

			if (this.reader) {
				try {
					await this.reader.cancel();
				} catch (error) {
					// Cancelling an already-closed reader is harmless.
				}
			}

			if (this.readableStreamClosed) {
				try {
					await this.readableStreamClosed;
				} catch (error) {
					// Closing the pipe may reject when the reader is cancelled.
				}
			}

			if (this.port) {
				try {
					await this.port.close();
				} catch (error) {
					// Some browsers throw if the device was removed before close.
				}
			}

			this.port = null;
			this.decoder = null;
			this.readableStreamClosed = null;
			this.setStatus("disconnected");
		}
	}

	function createController(options) {
		return new SerialScaleController(options);
	}

	return {
		DEFAULT_BAUD_RATE,
		createController,
		createParserState,
		decodeChunk,
		normalizeNumberText,
		parseNumber,
		parseScaleChunk,
		resolveOpenOptions,
		SerialScaleController,
	};
});
