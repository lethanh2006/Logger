"use strict";

const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} = require("@opentelemetry/api");
const {
  AsyncLocalStorageContextManager,
} = require("@opentelemetry/context-async-hooks");
const { W3CTraceContextPropagator } = require("@opentelemetry/core");
const {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} = require("@opentelemetry/sdk-trace-base");
const { logAndRecordException, withMessageSpan } = require("..");

const parentSpanContext = {
  traceId: "0af7651916cd43dd8448eb211c80319c",
  spanId: "b7ad6b7169203331",
  traceFlags: 1,
};
const traceparent =
  `00-${parentSpanContext.traceId}-${parentSpanContext.spanId}-01`;

const exporter = new InMemorySpanExporter();
const contextManager = new AsyncLocalStorageContextManager();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

before(() => {
  context.setGlobalContextManager(contextManager.enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  assert.equal(trace.setGlobalTracerProvider(provider), true);
});

beforeEach(() => {
  exporter.reset();
});

after(async () => {
  await provider.shutdown();
  context.disable();
  propagation.disable();
  trace.disable();
});

test("consumer span keeps incoming W3C parent and ends exactly once", async () => {
  let activeSpanId;

  const result = await withMessageSpan(
    "payment.confirmed consume",
    { traceparent },
    async (span) => {
      activeSpanId = trace.getSpan(context.active())?.spanContext().spanId;
      assert.equal(activeSpanId, span.spanContext().spanId);
      return "processed";
    },
    {
      attributes: {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "payment.confirmed",
      },
    },
  );

  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();

  assert.equal(result, "processed");
  assert.equal(spans.length, 1);
  assert.equal(spans[0].name, "payment.confirmed consume");
  assert.equal(spans[0].kind, SpanKind.CONSUMER);
  assert.equal(spans[0].spanContext().traceId, parentSpanContext.traceId);
  assert.equal(spans[0].parentSpanContext.spanId, parentSpanContext.spanId);
  assert.equal(spans[0].parentSpanContext.isRemote, true);
  assert.equal(spans[0].attributes["messaging.system"], "rabbitmq");
});

test("consumer failure records exception, error status and ends the span", async () => {
  await assert.rejects(
    withMessageSpan(
      "payment.failed consume",
      { traceparent },
      async () => {
        throw new Error("Bearer rabbit-secret");
      },
    ),
    /rabbit-secret/,
  );

  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();

  assert.equal(spans.length, 1);
  assert.equal(spans[0].status.code, SpanStatusCode.ERROR);
  assert.match(spans[0].status.message, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(spans[0].events), /rabbit-secret/);
  assert.equal(spans[0].events[0].name, "exception");
});

test("origin log and active span share the same errorId", async () => {
  const events = [];
  const logger = {
    error(fields, message) {
      events.push({ fields, message });
    },
  };
  const tracer = provider.getTracer("observability-correlation-test");
  let result;

  await tracer.startActiveSpan("payment.create", async (span) => {
    result = logAndRecordException(
      logger,
      "payment.create.failed",
      new Error("postgres://admin:database-secret@db/payment"),
      { request_id: "req-acceptance-1" },
    );
    span.end();
  });

  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();

  assert.equal(events.length, 1);
  assert.equal(spans.length, 1);
  assert.equal(result.recordedOnSpan, true);
  assert.equal(events[0].fields["error.id"], result.errorId);
  assert.equal(spans[0].attributes["error.id"], result.errorId);
  assert.equal(spans[0].status.code, SpanStatusCode.ERROR);
  assert.doesNotMatch(JSON.stringify(events), /database-secret/);
  assert.doesNotMatch(JSON.stringify(spans[0].events), /database-secret/);
});
