"use strict";

const contextHelpers = require("./context");
const errorHelpers = require("./errors");
const httpBoundaryHelpers = require("./http-boundary");
const loggerHelpers = require("./logger");
const messageContextHelpers = require("./message-context");
const metricHelpers = require("./metrics");
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
  startTelemetry(...args) {
    return sdkCall("startTelemetry", args);
  },
};
