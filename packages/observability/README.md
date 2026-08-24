# @nrapp/observability

Package CommonJS dùng chung cho backend NRApp: Pino structured log, correlation
`trace_id`/`span_id`/`request_id`, phân loại exception, W3C trace propagation qua
message headers, OTel trace/metric bootstrap và Nest `LoggerService` adapter.

Package là private local dependency, không cần publish registry:

```json
{
  "dependencies": {
    "@nrapp/observability": "file:../logger/packages/observability"
  },
  "scripts": {
    "start:prod": "node --require @nrapp/observability/register dist/main.js"
  }
}
```

`register` phải được preload trước khi `dist/main.js` import Nest/HTTP/database
drivers. Module này nạp `.env` từ working directory trước khi khởi động SDK. Có
thể đổi file bằng `OBSERVABILITY_ENV_FILE` hoặc tắt bằng
`OBSERVABILITY_LOAD_DOTENV=false`.

## Logger và Nest

```ts
import { NestFactory } from "@nestjs/core";
import {
  createAppLogger,
  PinoNestLogger,
  runWithLogContext,
} from "@nrapp/observability";

const rootLogger = createAppLogger({ serviceName: "payment" });
const app = await NestFactory.create(AppModule, {
  logger: new PinoNestLogger(rootLogger, "NestApplication"),
});

runWithLogContext({ request_id: "req-123" }, () => {
  rootLogger.info({ "event.name": "payment.created" }, "Payment created");
});
```

- `LOG_FORMAT=pretty` cho terminal development; production dùng
  `LOG_FORMAT=json`.
- `LOG_LEVEL` điều khiển level.
- `trace` đến `warn` đi ra `stdout`; `error` và `fatal` đi ra `stderr`. Khi test
  có thể truyền một `destination` riêng để thu toàn bộ event.
- Logger tự thêm resource fields, active trace/span và redaction. Không log raw
  body/header/payload dù đã có redaction dự phòng.

## Exception tại boundary

```ts
const result = logAndRecordException(
  rootLogger,
  "payment.create.failed",
  error,
  { request_id: requestId },
);

// result.errorId dùng trong response 500 an toàn.
```

Helper tạo UUID `errorId`, phân loại expected/retryable, ghi structured event và
record unexpected exception lên active span. Application/domain code không gọi
helper rồi rethrow; chỉ boundary sở hữu failure gọi đúng một lần.

## RabbitMQ/message context

Producer:

```ts
const headers = injectTraceHeaders({ "x-request-id": requestId });
channel.publish(exchange, routingKey, body, { headers });
```

Consumer:

```ts
await withMessageSpan(
  "payment.completed process",
  message.properties.headers,
  async () => handler(message),
  { attributes: { "messaging.destination.name": queueName } },
);
```

Package chủ động tắt auto-instrumentation `amqplib`; publisher/consumer wrapper
ở trên là nơi duy nhất tạo message span và inject/extract W3C context, tránh một
message sinh hai span trùng nhau.

## Metric rejection tại public edge

```ts
recordHttpRejection({
  method: request.method,
  route: "/auth/register", // luôn dùng route template
  statusCode: 429,
  errorCode: "RATE_LIMITED",
});
```

Không truyền user ID, request ID, URL thật hoặc dữ liệu người dùng làm metric
attribute.

## Biến môi trường OTel chính

```dotenv
OTEL_SERVICE_NAME=payment
OTEL_SERVICE_VERSION=git-sha
DEPLOYMENT_ENVIRONMENT=development
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_SAMPLER=parentbased_always_on
OTEL_METRIC_EXPORT_INTERVAL=60000
OTEL_HTTP_IGNORE_INCOMING_PATHS=/health,/healthz,/ready,/readiness
```

Local/staging có thể dùng `parentbased_always_on`; production phải chốt sampler
theo traffic. `OTEL_SDK_DISABLED=true` tắt SDK. Lỗi khởi động/export telemetry
được xử lý fail-open và không làm API business thất bại. Khi service shutdown
gracefully, gọi `shutdownTelemetry(timeoutMs)` trước khi process thoát.
