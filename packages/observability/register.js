"use strict";

let state;

try {
  const { loadEnvironment, startTelemetry } = require("./sdk");
  loadEnvironment();
  state = startTelemetry({ loadDotenv: false });
} catch (error) {
  state = {
    started: false,
    disabled: false,
    reason: "register-error",
    error,
  };
  try {
    process.stderr.write(
      `[observability] Bỏ qua lỗi preload OpenTelemetry để API tiếp tục chạy: ${
        error?.message || String(error)
      }\n`,
    );
  } catch {
    // Preload stays fail-open even if stderr is unavailable.
  }
}

module.exports = state;
