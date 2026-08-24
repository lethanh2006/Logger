"use strict";

const {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} = require("@opentelemetry/api");
const { sanitizeText, sanitizeValue } = require("./sanitizer");

const setter = {
  set(carrier, key, value) {
    carrier[String(key).toLowerCase()] = String(value);
  },
};

const getter = {
  keys(carrier) {
    return carrier && typeof carrier === "object" ? Object.keys(carrier) : [];
  },
  get(carrier, key) {
    if (!carrier || typeof carrier !== "object") {
      return undefined;
    }

    const normalizedKey = String(key).toLowerCase();
    const actualKey = Object.keys(carrier).find(
      (candidate) => candidate.toLowerCase() === normalizedKey,
    );
    const value = actualKey ? carrier[actualKey] : undefined;

    if (Buffer.isBuffer(value)) {
      return value.toString("utf8");
    }
    if (Array.isArray(value)) {
      return value.map((item) =>
        Buffer.isBuffer(item) ? item.toString("utf8") : String(item),
      );
    }
    return value === undefined || value === null ? undefined : String(value);
  },
};

function injectTraceHeaders(headers = {}, activeContext = context.active()) {
  const carrier = { ...(headers || {}) };
  propagation.inject(activeContext, carrier, setter);
  return carrier;
}

function extractTraceContext(headers = {}, parentContext = context.active()) {
  return propagation.extract(parentContext, headers || {}, getter);
}

function withExtractedTraceContext(headers, callback, ...args) {
  if (typeof callback !== "function") {
    throw new TypeError("callback must be a function");
  }

  const extracted = extractTraceContext(headers);
  return context.with(extracted, callback, undefined, ...args);
}

function primitiveSpanAttributes(attributes) {
  const sanitized = sanitizeValue(attributes || {});
  const result = {};

  for (const [key, value] of Object.entries(sanitized)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) &&
        value.every(
          (item) =>
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean",
        ))
    ) {
      result[key] = value;
    }
  }

  return result;
}

async function withMessageSpan(name, headers, callback, options = {}) {
  if (typeof callback !== "function") {
    throw new TypeError("callback must be a function");
  }

  const parent = extractTraceContext(headers);
  const tracer = trace.getTracer(
    options.instrumentationName || "@nrapp/observability",
    options.instrumentationVersion || "0.1.0",
  );

  return context.with(parent, () =>
    tracer.startActiveSpan(
      sanitizeText(name),
      {
        kind: options.kind ?? SpanKind.CONSUMER,
        attributes: primitiveSpanAttributes(options.attributes),
      },
      async (span) => {
        try {
          return await callback(span);
        } catch (error) {
          const exception = {
            name: sanitizeText(error?.name || "Error"),
            message: sanitizeText(error?.message || "Unknown error"),
            ...(error?.stack ? { stack: sanitizeText(error.stack) } : {}),
          };
          span.recordException(exception);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: exception.message,
          });
          throw error;
        } finally {
          span.end();
        }
      },
    ),
  );
}

module.exports = {
  extractTraceContext,
  injectTraceHeaders,
  withExtractedTraceContext,
  withMessageSpan,
};
