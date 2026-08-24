"use strict";

const { SpanStatusCode, context, trace } = require("@opentelemetry/api");
const {
  classifyException,
  createErrorId,
  exceptionFields,
} = require("./errors");
const { sanitizeText, sanitizeValue } = require("./sanitizer");

function recordExceptionOnActiveSpan(error, metadata = {}) {
  const span = trace.getSpan(context.active());
  if (!span) {
    return false;
  }

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

  if (metadata.errorId) {
    span.setAttribute("error.id", String(metadata.errorId));
  }
  if (metadata.code) {
    span.setAttribute("error.code", String(metadata.code));
  }
  return true;
}

function logAndRecordException(
  logger,
  eventName,
  error,
  eventContext = {},
  options = {},
) {
  if (!logger || typeof logger.error !== "function") {
    throw new TypeError("logger must implement the Pino logging methods");
  }

  const classification = classifyException(error, options.classification);
  const errorId =
    options.errorId || eventContext["error.id"] || createErrorId();
  const fields = {
    ...sanitizeValue(eventContext),
    "event.name": eventName,
    ...exceptionFields(error, classification, errorId),
  };
  const level =
    typeof logger[classification.logLevel] === "function"
      ? classification.logLevel
      : "error";

  logger[level](
    fields,
    sanitizeText(
      options.message ||
        (classification.expected
          ? classification.safeMessage
          : "Unexpected application error"),
    ),
  );

  const shouldRecord =
    !classification.expected || options.recordExpected === true;
  const recordedOnSpan = shouldRecord
    ? recordExceptionOnActiveSpan(error, {
        errorId,
        code: classification.code,
      })
    : false;

  return {
    errorId,
    classification,
    recordedOnSpan,
  };
}

module.exports = {
  logAndRecordException,
  recordExceptionOnActiveSpan,
};
