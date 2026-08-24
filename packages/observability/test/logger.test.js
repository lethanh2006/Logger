"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Writable } = require("node:stream");
const { test } = require("node:test");
const { PinoNestLogger, createAppLogger, runWithLogContext } = require("..");

function memoryDestination() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    text: () => chunks.join(""),
    jsonLines: () =>
      chunks
        .join("")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

test("JSON logger adds service and request correlation fields", () => {
  const output = memoryDestination();
  const logger = createAppLogger({
    serviceName: "payment",
    serviceVersion: "abc123",
    environment: "test",
    format: "json",
    destination: output.stream,
  });

  runWithLogContext({ request_id: "req-123" }, () => {
    logger.info({ "event.name": "payment.created" }, "Payment created");
  });

  const [event] = output.jsonLines();
  assert.equal(event.severity, "INFO");
  assert.equal(event["service.name"], "payment");
  assert.equal(event["service.version"], "abc123");
  assert.equal(event["deployment.environment"], "test");
  assert.equal(event.request_id, "req-123");
  assert.equal(event["event.name"], "payment.created");
  assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("logger redacts nested secrets, PII and secret-looking text", () => {
  const output = memoryDestination();
  const logger = createAppLogger({
    serviceName: "auth",
    format: "json",
    destination: output.stream,
  });

  logger.error(
    {
      nested: {
        password: "raw-password",
        email: "user@example.com",
      },
      headers: { authorization: "Bearer abc.def.ghi" },
      connection: "postgres://user:secret@postgres:5432/app",
    },
    "token=plain-secret",
  );

  const raw = output.text();
  assert.doesNotMatch(raw, /raw-password/);
  assert.doesNotMatch(raw, /user@example\.com/);
  assert.doesNotMatch(raw, /abc\.def\.ghi/);
  assert.doesNotMatch(raw, /user:secret@/);
  assert.doesNotMatch(raw, /plain-secret/);
  assert.match(raw, /\[REDACTED\]/);
});

test("pretty format writes a readable single-line event", async () => {
  const output = memoryDestination();
  const logger = createAppLogger({
    serviceName: "gateway",
    format: "pretty",
    colorize: false,
    destination: output.stream,
  });

  logger.warn({ "event.name": "http.request.rejected" }, "Request rejected");
  logger.flush();
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(output.text(), /WARN/);
  assert.match(output.text(), /Request rejected/);
  assert.match(output.text(), /http\.request\.rejected/);
});

test("Nest adapter maps context and severity to Pino", () => {
  const output = memoryDestination();
  const rootLogger = createAppLogger({
    serviceName: "mail",
    format: "json",
    destination: output.stream,
  });
  const logger = new PinoNestLogger(rootLogger, "Mailer");

  logger.warn("Delivery delayed");

  const [event] = output.jsonLines();
  assert.equal(event.severity, "WARN");
  assert.equal(event["nest.context"], "Mailer");
  assert.equal(event["event.name"], "nest.warn");
  assert.equal(event.message, "Delivery delayed");
});

test("default destinations keep informational events on stdout and errors on stderr", () => {
  const packageRoot = path.resolve(__dirname, "..");
  const source = `
    const { createAppLogger } = require(${JSON.stringify(packageRoot)});
    const logger = createAppLogger({ serviceName: "split-test", format: "json" });
    logger.info({ "event.name": "stdout.event" }, "stdout-only");
    logger.error({ "event.name": "stderr.event" }, "stderr-only");
    logger.flush();
  `;
  const result = spawnSync(process.execPath, ["-e", source], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stdout-only/);
  assert.doesNotMatch(result.stdout, /stderr-only/);
  assert.match(result.stderr, /stderr-only/);
  assert.doesNotMatch(result.stderr, /stdout-only/);
});
