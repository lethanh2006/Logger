"use strict";

const { classifyException } = require("./errors");
const { logAndRecordException } = require("./telemetry");
const { normalizeRouteTemplate } = require("./metrics");
const { sanitizeText } = require("./sanitizer");

function errorFrom(exception) {
  if (exception?.cause instanceof Error) {
    return exception.cause;
  }
  if (exception instanceof Error) {
    return exception;
  }
  return new Error(typeof exception === "string" ? exception : "Unknown error");
}

function readExceptionResponse(exception) {
  if (!exception || typeof exception !== "object") {
    return undefined;
  }
  try {
    return typeof exception.getResponse === "function"
      ? exception.getResponse()
      : exception.response;
  } catch {
    return undefined;
  }
}

function validationFieldsFromMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  const fields = [];
  for (const message of messages) {
    if (typeof message !== "string") continue;
    const match =
      /^property\s+([A-Za-z0-9_.[\]-]{1,100})\s/i.exec(message.trim()) ||
      /^([A-Za-z0-9_.[\]-]{1,100})\s/.exec(message.trim());
    if (match?.[1]) fields.push(match[1]);
  }
  return [...new Set(fields)].slice(0, 50);
}

function expectedResponseBody(exception, classification, requestId) {
  const raw = readExceptionResponse(exception);
  const rawRecord =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : undefined;
  const rawMessage = rawRecord?.message ?? raw;
  const validationFields = [
    ...new Set([
      ...classification.validationFields,
      ...validationFieldsFromMessages(rawMessage),
    ]),
  ].slice(0, 50);
  const validation = validationFields.length > 0;

  return {
    statusCode: classification.statusCode,
    code: validation ? "VALIDATION_ERROR" : classification.code,
    message: validation
      ? "Dữ liệu không hợp lệ"
      : sanitizeText(classification.safeMessage),
    ...(validation ? { details: { fields: validationFields } } : {}),
    requestId,
  };
}

function handleOriginHttpException(logger, exception, context = {}) {
  const classification = classifyException(exception);
  const requestId = context.requestId || "unknown";

  if (classification.expected) {
    return {
      statusCode: classification.statusCode,
      classification,
      errorId: undefined,
      body: expectedResponseBody(exception, classification, requestId),
    };
  }

  const route = normalizeRouteTemplate(context.route || "unknown");
  const result = logAndRecordException(
    logger,
    context.eventName || "http.request.failed",
    errorFrom(exception),
    {
      request_id: requestId,
      "http.request.method": String(context.method || "UNKNOWN").toUpperCase(),
      "http.route": route,
      "http.response.status_code": classification.statusCode,
    },
    {
      classification: {
        statusCode: classification.statusCode,
        code: classification.code,
        expected: false,
        retryable: classification.retryable,
        logLevel: "error",
        safeMessage: "Internal server error",
      },
    },
  );

  return {
    statusCode: classification.statusCode,
    classification,
    errorId: result.errorId,
    body: {
      statusCode: classification.statusCode,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId,
      errorId: result.errorId,
    },
  };
}

module.exports = {
  errorFrom,
  expectedResponseBody,
  handleOriginHttpException,
  readExceptionResponse,
  validationFieldsFromMessages,
};
