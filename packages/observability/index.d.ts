import type { Context, Span, SpanKind } from "@opentelemetry/api";
import type { NodeSDK } from "@opentelemetry/sdk-node";
import type { DestinationStream, Logger } from "pino";

export type LogFormat = "json" | "pretty";

export interface AppLoggerOptions {
  serviceName?: string;
  serviceVersion?: string;
  serviceInstanceId?: string;
  environment?: string;
  level?: string;
  format?: LogFormat;
  base?: Record<string, unknown>;
  destination?: DestinationStream;
  redactPaths?: string[];
  colorize?: boolean;
  prettyOptions?: Record<string, unknown>;
}

export declare const DEFAULT_REDACT_PATHS: readonly string[];
export declare function createAppLogger(options?: AppLoggerOptions): Logger;
export declare function resolveLogFormat(format?: string): LogFormat;
export declare function resolveLogLevel(level?: string): string;

export declare class PinoNestLogger {
  constructor(logger?: Logger, context?: string);
  logger: Logger;
  context?: string;
  setContext(context: string): void;
  log(message: unknown, ...optionalParams: unknown[]): void;
  error(message: unknown, ...optionalParams: unknown[]): void;
  warn(message: unknown, ...optionalParams: unknown[]): void;
  debug(message: unknown, ...optionalParams: unknown[]): void;
  verbose(message: unknown, ...optionalParams: unknown[]): void;
  fatal(message: unknown, ...optionalParams: unknown[]): void;
}

export interface ExceptionClassification {
  statusCode: number;
  code: string;
  expected: boolean;
  retryable: boolean;
  logLevel: string;
  safeMessage: string;
  validationFields: string[];
}

export interface ClassificationOverrides {
  statusCode?: number;
  code?: string;
  expected?: boolean;
  retryable?: boolean;
  logLevel?: string;
  safeMessage?: string;
}

export declare const DEFAULT_CODE_BY_STATUS: Readonly<Record<number, string>>;
export declare function createErrorId(): string;
export declare function classifyException(
  error: unknown,
  overrides?: ClassificationOverrides,
): ExceptionClassification;
export declare function exceptionFields(
  error: unknown,
  classification: ExceptionClassification,
  errorId: string,
): Record<string, unknown>;

export interface HttpBoundaryContext {
  requestId?: string;
  method?: string;
  route?: string;
  eventName?: string;
}

export interface HttpBoundaryResult {
  statusCode: number;
  classification: ExceptionClassification;
  errorId?: string;
  body: Record<string, unknown>;
}

export declare function handleOriginHttpException(
  logger: Logger,
  exception: unknown,
  context?: HttpBoundaryContext,
): HttpBoundaryResult;
export declare function validationFieldsFromMessages(
  messages: unknown,
): string[];

export declare function getLogContext(): Record<string, unknown>;
export declare function getTraceContext(): Record<string, string>;
export declare function getCorrelationFields(): Record<string, unknown>;
export declare function runWithLogContext<TArgs extends unknown[], TResult>(
  fields: Record<string, unknown>,
  callback: (...args: TArgs) => TResult,
  ...args: TArgs
): TResult;

export declare const REQUEST_ID_HEADER: "x-request-id";
export declare const CLIENT_REQUEST_ID_HEADER: "x-client-request-id";
export declare const SAFE_REQUEST_ID: RegExp;
export declare function isSafeRequestId(value: unknown): value is string;
export declare function createRequestCorrelation(
  incomingRequestId?: unknown,
  options?: {
    trustIncoming?: boolean;
    generate?: () => string;
  },
): { requestId: string; clientRequestId?: string };
export declare function requestIdFromLogContext(
  fallback?: unknown,
): string | undefined;

export declare function injectTraceHeaders(
  headers?: Record<string, unknown>,
  activeContext?: Context,
): Record<string, unknown>;
export declare function extractTraceContext(
  headers?: Record<string, unknown>,
  parentContext?: Context,
): Context;
export declare function withExtractedTraceContext<
  TArgs extends unknown[],
  TResult,
>(
  headers: Record<string, unknown>,
  callback: (...args: TArgs) => TResult,
  ...args: TArgs
): TResult;

export interface MessageSpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, unknown>;
  instrumentationName?: string;
  instrumentationVersion?: string;
}

export declare function withMessageSpan<T>(
  name: string,
  headers: Record<string, unknown>,
  callback: (span: Span) => T | Promise<T>,
  options?: MessageSpanOptions,
): Promise<T>;

export interface LogExceptionOptions {
  errorId?: string;
  message?: string;
  recordExpected?: boolean;
  classification?: ClassificationOverrides;
}

export declare function recordExceptionOnActiveSpan(
  error: unknown,
  metadata?: { errorId?: string; code?: string },
): boolean;
export declare function logAndRecordException(
  logger: Logger,
  eventName: string,
  error: unknown,
  eventContext?: Record<string, unknown>,
  options?: LogExceptionOptions,
): {
  errorId: string;
  classification: ExceptionClassification;
  recordedOnSpan: boolean;
};

export declare function normalizeRouteTemplate(route: string): string;
export declare function recordHttpRejection(input: {
  method: string;
  route: string;
  statusCode: number;
  errorCode?: string;
}): void;

export declare const REDACTED: "[REDACTED]";
export declare function isSensitiveKey(key: string): boolean;
export declare function sanitizeText<T>(value: T): T;
export declare function sanitizeValue(value: unknown): unknown;

export interface TelemetryState {
  sdk?: NodeSDK;
  started: boolean;
  disabled: boolean;
  reason?: string;
  startPromise?: Promise<void>;
  error?: unknown;
}

export interface TelemetryOptions {
  loadDotenv?: boolean;
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;
  resourceAttributes?: Record<string, string | number | boolean>;
  instrumentationConfig?: Record<string, unknown>;
  instrumentations?: unknown[];
  traceExporter?: unknown;
  traceExporterOptions?: Record<string, unknown>;
  metricReaders?: unknown[];
  metricExporter?: unknown;
  metricExporterOptions?: Record<string, unknown>;
  metricExportIntervalMillis?: number;
  metricExportTimeoutMillis?: number;
}

export declare function loadEnvironment(options?: TelemetryOptions): {
  loaded: boolean;
  reason?: string;
  parsed?: Record<string, string>;
  error?: unknown;
};
export declare function startTelemetry(
  options?: TelemetryOptions,
): TelemetryState;
export declare function getTelemetryState(): TelemetryState | undefined;
export declare function shutdownTelemetry(timeoutMs?: number): Promise<boolean>;
export declare function flushLoggerAndShutdownTelemetry(
  logger?: { flush?: () => unknown },
  timeoutMs?: number,
): Promise<boolean>;
