"use strict";

const { DiagConsoleLogger, DiagLogLevel, diag } = require("@opentelemetry/api");
const {
  getNodeAutoInstrumentations,
} = require("@opentelemetry/auto-instrumentations-node");
const {
  OTLPMetricExporter,
} = require("@opentelemetry/exporter-metrics-otlp-http");
const {
  OTLPTraceExporter,
} = require("@opentelemetry/exporter-trace-otlp-http");
const { resourceFromAttributes } = require("@opentelemetry/resources");
const { PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { sanitizeText } = require("./sanitizer");

const SDK_STATE_SYMBOL = Symbol.for("@nrapp/observability.otel-sdk-state");
const DEFAULT_IGNORED_HTTP_PATHS = Object.freeze([
  "/health",
  "/healthz",
  "/live",
  "/liveness",
  "/ready",
  "/readiness",
]);

function safeWarning(message, error) {
  const detail = error
    ? `: ${sanitizeText(error?.message || String(error))}`
    : "";
  try {
    process.stderr.write(`[observability] ${message}${detail}\n`);
  } catch {
    // Telemetry must never prevent application startup.
  }
}

function loadEnvironment(options = {}) {
  if (
    options.loadDotenv === false ||
    String(process.env.OBSERVABILITY_LOAD_DOTENV).toLowerCase() === "false"
  ) {
    return { loaded: false, reason: "disabled" };
  }

  try {
    const dotenv = require("dotenv");
    const result = dotenv.config({
      ...(process.env.OBSERVABILITY_ENV_FILE
        ? { path: process.env.OBSERVABILITY_ENV_FILE }
        : {}),
      quiet: true,
    });
    return result.error
      ? { loaded: false, reason: "not-found" }
      : { loaded: true, parsed: result.parsed };
  } catch (error) {
    safeWarning("Không thể nạp file môi trường cho telemetry", error);
    return { loaded: false, reason: "error", error };
  }
}

function configureDiagnostics() {
  const requested = String(process.env.OTEL_DIAG_LOG_LEVEL || "").toUpperCase();
  if (!requested) {
    return;
  }

  const levels = {
    ALL: DiagLogLevel.ALL,
    VERBOSE: DiagLogLevel.VERBOSE,
    DEBUG: DiagLogLevel.DEBUG,
    INFO: DiagLogLevel.INFO,
    WARN: DiagLogLevel.WARN,
    ERROR: DiagLogLevel.ERROR,
    NONE: DiagLogLevel.NONE,
  };
  diag.setLogger(
    new DiagConsoleLogger(),
    levels[requested] ?? DiagLogLevel.ERROR,
  );
}

function ignoredHttpPaths() {
  const configured = process.env.OTEL_HTTP_IGNORE_INCOMING_PATHS;
  return configured
    ? configured
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [...DEFAULT_IGNORED_HTTP_PATHS];
}

function requestPath(request) {
  try {
    return new URL(request?.url || "/", "http://observability.local").pathname;
  } catch {
    return "/";
  }
}

function defaultInstrumentationConfig() {
  const ignored = new Set(ignoredHttpPaths());
  return {
    "@opentelemetry/instrumentation-fs": { enabled: false },
    "@opentelemetry/instrumentation-pino": { enabled: false },
    // RabbitMQ spans and W3C propagation are owned by the explicit publisher /
    // consumer boundaries so a message never creates two overlapping spans.
    "@opentelemetry/instrumentation-amqplib": { enabled: false },
    "@opentelemetry/instrumentation-http": {
      ignoreIncomingRequestHook(request) {
        return ignored.has(requestPath(request));
      },
    },
  };
}

function isSdkDisabled() {
  return String(process.env.OTEL_SDK_DISABLED).toLowerCase() === "true";
}

function resourceAttributes(options) {
  return {
    "service.name":
      options.serviceName ||
      process.env.OTEL_SERVICE_NAME ||
      process.env.SERVICE_NAME ||
      "unknown-service",
    "service.version":
      options.serviceVersion ||
      process.env.OTEL_SERVICE_VERSION ||
      process.env.SERVICE_VERSION ||
      process.env.npm_package_version ||
      "unknown",
    "deployment.environment":
      options.environment ||
      process.env.DEPLOYMENT_ENVIRONMENT ||
      process.env.NODE_ENV ||
      "development",
    ...(options.resourceAttributes || {}),
  };
}

function createMetricReaders(options) {
  if (options.metricReaders) {
    return options.metricReaders;
  }
  if (String(process.env.OTEL_METRICS_EXPORTER).toLowerCase() === "none") {
    return [];
  }

  const interval = Number(
    process.env.OTEL_METRIC_EXPORT_INTERVAL ||
      options.metricExportIntervalMillis ||
      60_000,
  );
  const timeout = Number(
    process.env.OTEL_METRIC_EXPORT_TIMEOUT ||
      options.metricExportTimeoutMillis ||
      30_000,
  );

  return [
    new PeriodicExportingMetricReader({
      exporter:
        options.metricExporter ||
        new OTLPMetricExporter(options.metricExporterOptions || {}),
      exportIntervalMillis:
        Number.isFinite(interval) && interval > 0 ? interval : 60_000,
      exportTimeoutMillis:
        Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000,
    }),
  ];
}

function startTelemetry(options = {}) {
  loadEnvironment(options);

  if (globalThis[SDK_STATE_SYMBOL]) {
    return globalThis[SDK_STATE_SYMBOL];
  }
  if (isSdkDisabled()) {
    const state = {
      started: false,
      disabled: true,
      reason: "OTEL_SDK_DISABLED",
    };
    globalThis[SDK_STATE_SYMBOL] = state;
    return state;
  }

  configureDiagnostics();

  try {
    const instrumentationConfig = {
      ...defaultInstrumentationConfig(),
      ...(options.instrumentationConfig || {}),
    };
    const sdk = new NodeSDK({
      resource: resourceFromAttributes(resourceAttributes(options)),
      traceExporter:
        options.traceExporter ||
        new OTLPTraceExporter(options.traceExporterOptions || {}),
      metricReaders: createMetricReaders(options),
      instrumentations: options.instrumentations || [
        getNodeAutoInstrumentations(instrumentationConfig),
      ],
    });
    const state = {
      sdk,
      started: true,
      disabled: false,
      startPromise: undefined,
      error: undefined,
    };
    globalThis[SDK_STATE_SYMBOL] = state;

    const startResult = sdk.start();
    if (startResult && typeof startResult.then === "function") {
      state.startPromise = startResult.catch((error) => {
        state.started = false;
        state.error = error;
        safeWarning("OpenTelemetry SDK khởi động không thành công", error);
      });
    }

    return state;
  } catch (error) {
    const state = {
      started: false,
      disabled: false,
      reason: "startup-error",
      error,
    };
    globalThis[SDK_STATE_SYMBOL] = state;
    safeWarning(
      "Bỏ qua lỗi khởi động OpenTelemetry để API tiếp tục chạy",
      error,
    );
    return state;
  }
}

function getTelemetryState() {
  return globalThis[SDK_STATE_SYMBOL];
}

async function settleWithTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function shutdownTelemetry(timeoutMs = 5_000) {
  const state = getTelemetryState();
  if (!state?.sdk || !state.started) {
    return true;
  }

  try {
    const stopped = await settleWithTimeout(
      Promise.resolve(state.sdk.shutdown()).then(() => true),
      timeoutMs,
    );
    state.started = false;
    return stopped;
  } catch (error) {
    state.started = false;
    safeWarning("Không thể shutdown telemetry sạch", error);
    return false;
  }
}

module.exports = {
  DEFAULT_IGNORED_HTTP_PATHS,
  getTelemetryState,
  loadEnvironment,
  shutdownTelemetry,
  startTelemetry,
};
