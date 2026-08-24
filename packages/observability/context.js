"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { context, isSpanContextValid, trace } = require("@opentelemetry/api");
const { sanitizeValue } = require("./sanitizer");

const STORAGE_SYMBOL = Symbol.for("@nrapp/observability.log-context");

if (!globalThis[STORAGE_SYMBOL]) {
  globalThis[STORAGE_SYMBOL] = new AsyncLocalStorage();
}

const storage = globalThis[STORAGE_SYMBOL];

function cleanContextFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return {};
  }

  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return sanitizeValue(result);
}

function runWithLogContext(fields, callback, ...args) {
  if (typeof callback !== "function") {
    throw new TypeError("callback must be a function");
  }

  const parent = storage.getStore() || {};
  const next = Object.freeze({
    ...parent,
    ...cleanContextFields(fields),
  });

  return storage.run(next, callback, ...args);
}

function getLogContext() {
  return storage.getStore() || {};
}

function getTraceContext() {
  const span = trace.getSpan(context.active());
  if (!span) {
    return {};
  }

  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) {
    return {};
  }

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: spanContext.traceFlags.toString(16).padStart(2, "0"),
  };
}

function getCorrelationFields() {
  return {
    ...getLogContext(),
    ...getTraceContext(),
  };
}

module.exports = {
  getCorrelationFields,
  getLogContext,
  getTraceContext,
  runWithLogContext,
};
