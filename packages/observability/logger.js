"use strict";

const pino = require("pino");
const pinoPretty = require("pino-pretty");
const { getCorrelationFields } = require("./context");
const { sanitizeText, sanitizeValue } = require("./sanitizer");

const DEFAULT_REDACT_PATHS = Object.freeze([
  "authorization",
  "cookie",
  "password",
  "otp",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "email",
  "phone",
  "payload",
  "request.body",
  "response.body",
  "req.body",
  "res.body",
  "headers.authorization",
  "headers.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.otp",
  "*.secret",
  "*.token",
  "*.access_token",
  "*.refresh_token",
  "*.api_key",
  "*.email",
  "*.phone",
]);

const PINO_LEVELS = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

function resolveLogLevel(level) {
  const normalized = String(
    level || process.env.LOG_LEVEL || "info",
  ).toLowerCase();
  return PINO_LEVELS.has(normalized) ? normalized : "info";
}

function resolveLogFormat(format) {
  const normalized = String(
    format || process.env.LOG_FORMAT || "",
  ).toLowerCase();
  if (normalized === "json" || normalized === "pretty") {
    return normalized;
  }
  return ["production", "test"].includes(process.env.NODE_ENV)
    ? "json"
    : "pretty";
}

function isoTimestamp() {
  return `,"timestamp":"${new Date().toISOString()}"`;
}

function sanitizeLogArguments(args) {
  return args.map((argument) => {
    if (typeof argument === "string") {
      return sanitizeText(argument);
    }
    if (argument && typeof argument === "object") {
      return sanitizeValue(argument);
    }
    return argument;
  });
}

function createPrettyDestination(options, destination) {
  return pinoPretty({
    colorize:
      options.colorize === undefined
        ? Boolean(process.stdout.isTTY)
        : Boolean(options.colorize),
    singleLine: true,
    translateTime: "SYS:standard",
    messageKey: "message",
    timestampKey: "timestamp",
    ignore: "pid",
    ...(destination ? { destination } : {}),
    ...options.prettyOptions,
  });
}

function createSplitDestination(format, options) {
  const stdoutDestination =
    format === "pretty"
      ? createPrettyDestination(options, process.stdout)
      : process.stdout;
  const stderrDestination =
    format === "pretty"
      ? createPrettyDestination(options, process.stderr)
      : process.stderr;

  return pino.multistream(
    [
      { level: "trace", stream: stdoutDestination },
      { level: "error", stream: stderrDestination },
    ],
    { dedupe: true },
  );
}

function createAppLogger(options = {}) {
  const serviceName =
    options.serviceName ||
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    "unknown-service";
  const serviceVersion =
    options.serviceVersion ||
    process.env.OTEL_SERVICE_VERSION ||
    process.env.SERVICE_VERSION ||
    process.env.npm_package_version ||
    "unknown";
  const environment =
    options.environment ||
    process.env.DEPLOYMENT_ENVIRONMENT ||
    process.env.NODE_ENV ||
    "development";
  const serviceInstanceId =
    options.serviceInstanceId ||
    process.env.OTEL_SERVICE_INSTANCE_ID ||
    process.env.HOSTNAME;
  const format = resolveLogFormat(options.format);

  const base = {
    ...sanitizeValue(options.base || {}),
    pid: process.pid,
    "service.name": serviceName,
    "service.version": serviceVersion,
    "deployment.environment": environment,
    ...(serviceInstanceId ? { "service.instance.id": serviceInstanceId } : {}),
  };

  const loggerOptions = {
    level: resolveLogLevel(options.level),
    base,
    messageKey: "message",
    timestamp: isoTimestamp,
    formatters: {
      level(label) {
        return { severity: label.toUpperCase() };
      },
    },
    mixin: getCorrelationFields,
    redact: {
      paths: [...DEFAULT_REDACT_PATHS, ...(options.redactPaths || [])],
      censor: "[REDACTED]",
    },
    hooks: {
      logMethod(args, method) {
        return method.apply(this, sanitizeLogArguments(args));
      },
    },
  };

  if (options.destination && format === "pretty") {
    return pino(
      loggerOptions,
      createPrettyDestination(options, options.destination),
    );
  }

  if (options.destination) {
    return pino(loggerOptions, options.destination);
  }

  return pino(loggerOptions, createSplitDestination(format, options));
}

function normalizeNestMessage(message) {
  if (message instanceof Error) {
    const error = sanitizeValue(message);
    return {
      fields: { error },
      message: error.message,
    };
  }
  if (message && typeof message === "object") {
    return {
      fields: sanitizeValue(message),
      message:
        typeof message.message === "string"
          ? sanitizeText(message.message)
          : "Nest application event",
    };
  }
  return {
    fields: {},
    message: sanitizeText(String(message)),
  };
}

function looksLikeStackTrace(value) {
  return (
    typeof value === "string" &&
    (/^\s*(?:Error|[A-Za-z]+Error)(?::|\n)/.test(value) ||
      /\n\s+at\s/.test(value))
  );
}

function splitNestOptionalParams(optionalParams, defaultContext, errorLevel) {
  const values = [...optionalParams];
  let context = defaultContext;

  const onlyValueIsStack =
    errorLevel && values.length === 1 && looksLikeStackTrace(values[0]);
  if (
    !onlyValueIsStack &&
    values.length > 0 &&
    typeof values.at(-1) === "string"
  ) {
    context = sanitizeText(values.pop());
  }

  return { context, values };
}

class PinoNestLogger {
  constructor(logger = createAppLogger(), context) {
    this.logger = logger;
    this.context = context;
  }

  setContext(context) {
    this.context = context;
  }

  log(message, ...optionalParams) {
    this.write("info", message, optionalParams);
  }

  error(message, ...optionalParams) {
    this.write("error", message, optionalParams, true);
  }

  warn(message, ...optionalParams) {
    this.write("warn", message, optionalParams);
  }

  debug(message, ...optionalParams) {
    this.write("debug", message, optionalParams);
  }

  verbose(message, ...optionalParams) {
    this.write("trace", message, optionalParams);
  }

  fatal(message, ...optionalParams) {
    this.write("fatal", message, optionalParams);
  }

  write(level, input, optionalParams, errorLevel = false) {
    const normalized = normalizeNestMessage(input);
    const { context, values } = splitNestOptionalParams(
      optionalParams,
      this.context,
      errorLevel,
    );
    const fields = {
      ...normalized.fields,
      "event.name": `nest.${level}`,
      ...(context ? { "nest.context": context } : {}),
    };

    if (values.length > 0) {
      fields["nest.parameters"] = sanitizeValue(values);
    }

    this.logger[level](fields, normalized.message);
  }
}

module.exports = {
  DEFAULT_REDACT_PATHS,
  PinoNestLogger,
  createAppLogger,
  resolveLogFormat,
  resolveLogLevel,
};
