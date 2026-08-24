"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  classifyException,
  createErrorId,
  logAndRecordException,
} = require("..");

function fakeHttpError(status, response) {
  const error = new Error(
    typeof response?.message === "string" ? response.message : "Request failed",
  );
  error.getStatus = () => status;
  error.getResponse = () => response;
  return error;
}

test("createErrorId returns UUIDs", () => {
  const first = createErrorId();
  const second = createErrorId();
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.notEqual(first, second);
});

test("classifier keeps sanitized expected HTTP contract", () => {
  const error = fakeHttpError(422, {
    code: "validation_error",
    message: "Dữ liệu không hợp lệ",
    details: { fields: ["email", "profile.name", "bad field value"] },
  });

  const result = classifyException(error);
  assert.deepEqual(result, {
    statusCode: 422,
    code: "VALIDATION_ERROR",
    expected: true,
    retryable: false,
    logLevel: "info",
    safeMessage: "Dữ liệu không hợp lệ",
    validationFields: ["email", "profile.name"],
  });
});

test("classifier hides unexpected error message from client contract", () => {
  const error = Object.assign(new Error("postgres://admin:secret@db/app"), {
    code: "ECONNREFUSED",
  });

  const result = classifyException(error);
  assert.equal(result.statusCode, 500);
  assert.equal(result.code, "ECONNREFUSED");
  assert.equal(result.expected, false);
  assert.equal(result.safeMessage, "Internal server error");
  assert.equal(result.logLevel, "error");
});

test("exception helper emits one sanitized origin event and returns errorId", () => {
  const events = [];
  const logger = {
    error(fields, message) {
      events.push({ level: "error", fields, message });
    },
  };
  const error = new Error("Bearer raw-api-token");

  const result = logAndRecordException(logger, "payment.create.failed", error, {
    request_id: "req-1",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].fields["error.id"], result.errorId);
  assert.equal(events[0].fields["event.name"], "payment.create.failed");
  assert.equal(events[0].fields.request_id, "req-1");
  assert.doesNotMatch(JSON.stringify(events), /raw-api-token/);
  assert.equal(result.recordedOnSpan, false);
});
