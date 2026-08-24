"use strict";

const { metrics } = require("@opentelemetry/api");

const meter = metrics.getMeter("@nrapp/observability", "0.1.0");
const rejectedRequests = meter.createCounter("http.server.request.rejections", {
  description:
    "Number of client-facing HTTP requests rejected at a public edge",
  unit: "{request}",
});

function normalizeRouteTemplate(route) {
  if (typeof route !== "string" || !route.trim()) {
    return "unknown";
  }

  const withoutQuery = route.trim().split(/[?#]/, 1)[0];
  return withoutQuery
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
      "/:id",
    )
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, "/:id")
    .slice(0, 200);
}

function normalizeMethod(method) {
  const normalized = String(method || "UNKNOWN").toUpperCase();
  return /^[A-Z]{1,12}$/.test(normalized) ? normalized : "UNKNOWN";
}

function normalizeStatusCode(statusCode) {
  const normalized = Number(statusCode);
  return Number.isInteger(normalized) && normalized >= 400 && normalized <= 599
    ? normalized
    : 0;
}

function normalizeErrorCode(errorCode) {
  const normalized = String(errorCode || "UNKNOWN")
    .toUpperCase()
    .replace(/[^A-Z0-9_.-]+/g, "_")
    .slice(0, 100);
  return normalized || "UNKNOWN";
}

function recordHttpRejection({ method, route, statusCode, errorCode }) {
  rejectedRequests.add(1, {
    "http.request.method": normalizeMethod(method),
    "http.route": normalizeRouteTemplate(route),
    "http.response.status_code": normalizeStatusCode(statusCode),
    "error.code": normalizeErrorCode(errorCode),
  });
}

module.exports = {
  normalizeRouteTemplate,
  recordHttpRejection,
};
