"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  CLIENT_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
  createRequestCorrelation,
  flushLoggerAndShutdownTelemetry,
  isSafeRequestId,
  requestIdFromLogContext,
  runWithLogContext,
} = require("..");

test("request ID contract rejects ambiguous or oversized values", () => {
  assert.equal(REQUEST_ID_HEADER, "x-request-id");
  assert.equal(CLIENT_REQUEST_ID_HEADER, "x-client-request-id");
  assert.equal(isSafeRequestId("request-123:worker.1"), true);
  assert.equal(isSafeRequestId(".request-123"), false);
  assert.equal(isSafeRequestId("request id"), false);
  assert.equal(isSafeRequestId("a".repeat(129)), false);
  assert.equal(isSafeRequestId(["request-123"]), false);
});

test("trusted boundary keeps a safe canonical request ID", () => {
  assert.deepEqual(
    createRequestCorrelation("gateway-request-1", {
      generate: () => "generated-request-1",
    }),
    { requestId: "gateway-request-1" },
  );
});

test("public boundary creates a canonical ID and preserves safe client ID", () => {
  assert.deepEqual(
    createRequestCorrelation("client-request-1", {
      trustIncoming: false,
      generate: () => "canonical-request-1",
    }),
    {
      requestId: "canonical-request-1",
      clientRequestId: "client-request-1",
    },
  );
});

test("outbound adapter can read canonical request ID from log context", () => {
  runWithLogContext({ request_id: "request-als-1" }, () => {
    assert.equal(requestIdFromLogContext(), "request-als-1");
  });
  assert.equal(requestIdFromLogContext("request-fallback-1"), "request-fallback-1");
});

test("lifecycle helper flushes logger even when telemetry is not running", async () => {
  let flushed = false;
  const stopped = await flushLoggerAndShutdownTelemetry({
    flush() {
      flushed = true;
    },
  });

  assert.equal(flushed, true);
  assert.equal(stopped, true);
});
