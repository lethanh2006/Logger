"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { context, propagation, trace } = require("@opentelemetry/api");
const {
  AsyncLocalStorageContextManager,
} = require("@opentelemetry/context-async-hooks");
const { W3CTraceContextPropagator } = require("@opentelemetry/core");
const {
  getCorrelationFields,
  injectTraceHeaders,
  runWithLogContext,
  withExtractedTraceContext,
} = require("..");

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

const spanContext = {
  traceId: "0af7651916cd43dd8448eb211c80319c",
  spanId: "b7ad6b7169203331",
  traceFlags: 1,
};

test("logger correlation combines active trace and local request context", () => {
  const active = trace.setSpanContext(context.active(), spanContext);

  context.with(active, () =>
    runWithLogContext({ request_id: "req-123" }, () => {
      assert.deepEqual(getCorrelationFields(), {
        request_id: "req-123",
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
        trace_flags: "01",
      });
    }),
  );
});

test("W3C trace headers are injected without mutating input", () => {
  const original = { "x-request-id": "req-123" };
  const active = trace.setSpanContext(context.active(), spanContext);
  const headers = context.with(active, () => injectTraceHeaders(original));

  assert.deepEqual(original, { "x-request-id": "req-123" });
  assert.equal(
    headers.traceparent,
    `00-${spanContext.traceId}-${spanContext.spanId}-01`,
  );
  assert.equal(headers["x-request-id"], "req-123");
});

test("W3C trace headers are extracted around consumer callback", () => {
  const headers = {
    traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-01`,
  };

  withExtractedTraceContext(headers, () => {
    const extracted = trace.getSpanContext(context.active());
    assert.equal(extracted.traceId, spanContext.traceId);
    assert.equal(extracted.spanId, spanContext.spanId);
    assert.equal(extracted.isRemote, true);
  });
});
