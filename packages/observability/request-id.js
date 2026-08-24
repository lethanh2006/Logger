"use strict";

const { randomUUID } = require("node:crypto");
const { getLogContext } = require("./context");

const REQUEST_ID_HEADER = "x-request-id";
const CLIENT_REQUEST_ID_HEADER = "x-client-request-id";
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isSafeRequestId(value) {
  return typeof value === "string" && SAFE_REQUEST_ID.test(value);
}

function createRequestCorrelation(incomingRequestId, options = {}) {
  const trusted = options.trustIncoming !== false;
  const safeIncoming = isSafeRequestId(incomingRequestId)
    ? incomingRequestId
    : undefined;
  const generate =
    typeof options.generate === "function" ? options.generate : randomUUID;
  const requestId = trusted && safeIncoming ? safeIncoming : generate();

  if (!isSafeRequestId(requestId)) {
    throw new TypeError("generated request ID must match the safe contract");
  }

  return {
    requestId,
    ...(!trusted && safeIncoming ? { clientRequestId: safeIncoming } : {}),
  };
}

function requestIdFromLogContext(fallback) {
  const requestId = getLogContext().request_id;
  if (isSafeRequestId(requestId)) {
    return requestId;
  }
  return isSafeRequestId(fallback) ? fallback : undefined;
}

module.exports = {
  CLIENT_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
  SAFE_REQUEST_ID,
  createRequestCorrelation,
  isSafeRequestId,
  requestIdFromLogContext,
};
