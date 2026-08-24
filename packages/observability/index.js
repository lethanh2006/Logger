"use strict";

const contextHelpers = require("./context");
const errorHelpers = require("./errors");
const httpBoundaryHelpers = require("./http-boundary");
const loggerHelpers = require("./logger");
const messageContextHelpers = require("./message-context");
const metricHelpers = require("./metrics");
const requestIdHelpers = require("./request-id");
const sanitizerHelpers = require("./sanitizer");
const telemetryHelpers = require("./telemetry");

function sdkCall(method, args) {
  return require("./sdk")[method](...args);
}

module.exports = {
  ...contextHelpers,
  ...errorHelpers,
  ...httpBoundaryHelpers,
  ...loggerHelpers,
  ...messageContextHelpers,
  ...metricHelpers,
  ...requestIdHelpers,
  ...sanitizerHelpers,
  ...telemetryHelpers,
  getTelemetryState(...args) {
    return sdkCall("getTelemetryState", args);
  },
  loadEnvironment(...args) {
    return sdkCall("loadEnvironment", args);
  },
  shutdownTelemetry(...args) {
    return sdkCall("shutdownTelemetry", args);
  },
  async flushLoggerAndShutdownTelemetry(logger, timeoutMs = 3_000) {
    try {
      if (logger && typeof logger.flush === "function") {
        await Promise.resolve(logger.flush());
      }
    } finally {
      return sdkCall("shutdownTelemetry", [timeoutMs]);
    }
  },
  startTelemetry(...args) {
    return sdkCall("startTelemetry", args);
  },
};
