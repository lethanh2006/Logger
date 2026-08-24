"use strict";

const { randomUUID } = require("node:crypto");
const { sanitizeText } = require("./sanitizer");

const DEFAULT_CODE_BY_STATUS = Object.freeze({
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
});

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 502, 503, 504]);

function createErrorId() {
  return randomUUID();
}

function readHttpResponse(error) {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  if (typeof error.getResponse === "function") {
    try {
      return error.getResponse();
    } catch {
      return undefined;
    }
  }
  return error.response;
}

function readStatus(error, response) {
  const candidates = [
    typeof error?.getStatus === "function"
      ? error.getStatus.bind(error)
      : undefined,
    error?.status,
    error?.statusCode,
    response && typeof response === "object" ? response.statusCode : undefined,
  ];

  for (const candidate of candidates) {
    let value = candidate;
    if (typeof candidate === "function") {
      try {
        value = candidate();
      } catch {
        continue;
      }
    }
    const status = Number(value);
    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return status;
    }
  }

  return 500;
}

function normalizeErrorCode(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .toUpperCase()
    .slice(0, 100);
  return normalized || fallback;
}

function readErrorCode(error, response, statusCode) {
  const fallback = DEFAULT_CODE_BY_STATUS[statusCode] || `HTTP_${statusCode}`;
  const responseCode =
    response && typeof response === "object" ? response.code : undefined;

  return normalizeErrorCode(
    error?.errorCode || error?.code || responseCode,
    fallback,
  );
}

function readSafeMessage(error, response, expected) {
  if (!expected) {
    return "Internal server error";
  }

  const candidates = [
    error?.safeMessage,
    response && typeof response === "object" ? response.safeMessage : undefined,
    response && typeof response === "object" ? response.message : undefined,
    typeof response === "string" ? response : undefined,
    error?.message,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return sanitizeText(candidate.trim());
    }
  }

  return "Request rejected";
}

function readValidationFields(response) {
  if (!response || typeof response !== "object") {
    return [];
  }

  const values = response.details?.fields || response.fields;
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .filter((field) => typeof field === "string")
        .map((field) => field.trim())
        .filter((field) => /^[A-Za-z0-9_.\[\]-]{1,100}$/.test(field)),
    ),
  ].slice(0, 50);
}

function classifyException(error, overrides = {}) {
  const response = readHttpResponse(error);
  const statusCode = overrides.statusCode || readStatus(error, response);
  const expected =
    typeof overrides.expected === "boolean"
      ? overrides.expected
      : typeof error?.expected === "boolean"
        ? error.expected
        : statusCode >= 400 && statusCode < 500;
  const code = normalizeErrorCode(
    overrides.code,
    readErrorCode(error, response, statusCode),
  );
  const retryable =
    typeof overrides.retryable === "boolean"
      ? overrides.retryable
      : typeof error?.retryable === "boolean"
        ? error.retryable
        : RETRYABLE_STATUS_CODES.has(statusCode);
  const logLevel =
    overrides.logLevel ||
    (statusCode >= 500
      ? "error"
      : statusCode === 429 || statusCode === 403
        ? "warn"
        : "info");

  return {
    statusCode,
    code,
    expected,
    retryable,
    logLevel,
    safeMessage:
      overrides.safeMessage || readSafeMessage(error, response, expected),
    validationFields: readValidationFields(response),
  };
}

function exceptionFields(error, classification, errorId) {
  const name = sanitizeText(error?.name || "Error");
  const message = sanitizeText(error?.message || "Unknown error");
  const fields = {
    "error.id": errorId,
    "error.code": classification.code,
    "error.expected": classification.expected,
    "error.retryable": classification.retryable,
    "http.response.status_code": classification.statusCode,
    "exception.type": name,
    "exception.message": message,
  };

  if (error?.stack) {
    fields["exception.stacktrace"] = sanitizeText(error.stack);
  }
  if (classification.validationFields.length > 0) {
    fields["validation.fields"] = classification.validationFields;
  }

  return fields;
}

module.exports = {
  DEFAULT_CODE_BY_STATUS,
  classifyException,
  createErrorId,
  exceptionFields,
};
