"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const { normalizeRouteTemplate } = require("..");

test("register preload is safe when OTel SDK is disabled", () => {
  const register = path.resolve(__dirname, "..", "register.js");
  const result = spawnSync(
    process.execPath,
    [
      "--require",
      register,
      "-e",
      'process.stdout.write("application-started")',
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        OBSERVABILITY_LOAD_DOTENV: "false",
        OTEL_SDK_DISABLED: "true",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "application-started");
});

test("metric timeout is clamped so a short interval does not disable tracing", () => {
  const packageRoot = path.resolve(__dirname, "..");
  const register = path.join(packageRoot, "register.js");
  const source = `
    const state = require(${JSON.stringify(register)});
    const { shutdownTelemetry } = require(${JSON.stringify(packageRoot)});
    Promise.resolve(state.startPromise).then(async () => {
      process.stdout.write(state.started ? "telemetry-started" : "telemetry-failed");
      await shutdownTelemetry(3000);
    });
  `;
  const result = spawnSync(process.execPath, ["-e", source], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      OBSERVABILITY_LOAD_DOTENV: "false",
      OTEL_SDK_DISABLED: "false",
      OTEL_SERVICE_NAME: "metric-timing-test",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
      OTEL_METRIC_EXPORT_INTERVAL: "1000",
      OTEL_METRIC_EXPORT_TIMEOUT: "30000",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "telemetry-started");
});

test("metric route helper removes raw identifiers and queries", () => {
  assert.equal(
    normalizeRouteTemplate(
      "/users/0192ca6d-3438-7a12-8000-112233445566/orders/123?token=secret",
    ),
    "/users/:id/orders/:id",
  );
  assert.equal(normalizeRouteTemplate("/health"), "/health");
});
