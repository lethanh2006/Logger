"use strict";

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const MAX_DEPTH = 8;
const MAX_STRING_LENGTH = 8_192;

const SENSITIVE_KEY =
  /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|pwd|passcode|otp|one[-_]?time[-_]?password|secret|client[-_]?secret|access[-_]?token|refresh[-_]?token|id[-_]?token|token|api[-_]?key|private[-_]?key|card[-_]?number|credit[-_]?card|cvv|cvc|pin|connection[-_]?string|dsn|email|e[-_]?mail|phone|phone[-_]?number|recipient|mail[-_]?body|chat[-_]?content|request[-_]?body|response[-_]?body|raw[-_]?payload|payload)$/i;

function sanitizeText(value) {
  if (typeof value !== "string") {
    return value;
  }

  let sanitized = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(
      /\b(password|passwd|pwd|otp|secret|token|authorization|cookie|api[-_]?key)\s*[:=]\s*([^\s,;]+)/gi,
      (_match, key) => `${key}=${REDACTED}`,
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`);

  if (sanitized.length > MAX_STRING_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`;
  }

  return sanitized;
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(String(key).replace(/[.\s]/g, "_"));
}

function serializeError(error, seen, depth) {
  const result = {
    type: sanitizeText(error.name || "Error"),
    message: sanitizeText(error.message || "Unknown error"),
  };

  if (error.stack) {
    result.stack = sanitizeText(error.stack);
  }
  if (typeof error.code === "string" || typeof error.code === "number") {
    result.code = sanitizeText(String(error.code));
  }
  if (error.cause && depth < MAX_DEPTH) {
    result.cause = sanitizeValue(error.cause, seen, depth + 1);
  }

  return result;
}

function sanitizeValue(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes omitted]`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return serializeError(value, seen, depth);
  }
  if (depth >= MAX_DEPTH) {
    return "[Max depth reached]";
  }
  if (seen.has(value)) {
    return CIRCULAR;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizeValue(item, seen, depth + 1));
    seen.delete(value);
    return result;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSensitiveKey(key)
      ? REDACTED
      : sanitizeValue(item, seen, depth + 1);
  }

  seen.delete(value);
  return result;
}

module.exports = {
  REDACTED,
  isSensitiveKey,
  sanitizeText,
  sanitizeValue,
};
