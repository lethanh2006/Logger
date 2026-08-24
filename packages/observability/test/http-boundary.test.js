"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { handleOriginHttpException } = require("..");

function httpError(status, response, cause) {
  const error = new Error("technical message", cause ? { cause } : undefined);
  error.getStatus = () => status;
  error.getResponse = () => response;
  return error;
}

test("expected validation creates a safe envelope without an error event", () => {
  const events = [];
  const result = handleOriginHttpException(
    { error: (...args) => events.push(args) },
    httpError(400, {
      statusCode: 400,
      message: ["email must be an email", "property role should not exist"],
    }),
    { requestId: "req-1", method: "POST", route: "/auth/register" },
  );

  assert.equal(events.length, 0);
  assert.deepEqual(result.body, {
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: "Dữ liệu không hợp lệ",
    details: { fields: ["email", "role"] },
    requestId: "req-1",
  });
});

test("unexpected exception creates one origin event and safe errorId response", () => {
  const events = [];
  const logger = {
    error(fields, message) {
      events.push({ fields, message });
    },
  };
  const result = handleOriginHttpException(
    logger,
    httpError(500, { message: "postgres://root:secret@db/app" }),
    { requestId: "req-2", method: "GET", route: "/users/123" },
  );

  assert.equal(events.length, 1);
  assert.equal(result.body.code, "INTERNAL_ERROR");
  assert.equal(result.body.errorId, result.errorId);
  assert.equal(result.body.message, "Internal server error");
  assert.doesNotMatch(JSON.stringify(result), /root:secret/);
});
