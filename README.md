# Backend observability

Stack này tách tín hiệu theo đúng mục đích:

- ứng dụng gửi trace/metric bằng OTLP tới OpenTelemetry Collector;
- Collector batch/retry trace sang Jaeger và expose OTLP metric để Prometheus
  scrape;
- Prometheus scrape host, container và các thành phần observability;
- Grafana dùng Prometheus mặc định cho hạ tầng và Jaeger cho distributed trace;
- Alloy chỉ chuyển log hệ thống/hạ tầng sang Loki, không dùng Loki để tính API
  latency hoặc làm error center.

Logger Express cũ đã được gỡ. Backend không POST log đồng bộ tới `/api/log`;
structured log đi thẳng ra `stdout`/`stderr`, còn telemetry được export bất đồng
bộ qua OpenTelemetry.

## Phạm vi môi trường

Jaeger trong Compose dùng all-in-one memory storage. Cấu hình này phù hợp local
và staging ngắn hạn; restart container sẽ mất trace. Production phải dùng
persistent storage, retention, authentication/TLS và sizing riêng.

`node-exporter` và cAdvisor đọc host Linux/Docker hiện tại. cAdvisor cần quyền
`privileged` cùng các read-only host mounts để đọc đủ cgroup/container metrics;
không chạy stack này trên Docker host không tin cậy.

## Khởi động

Từ thư mục `backend`:

```bash
test -f logger/.env || cp logger/.env.example logger/.env
```

Đổi `GRAFANA_ADMIN_PASSWORD` thành mật khẩu mạnh, sau đó:

```bash
npm run observability:config
npm run observability:up
node scripts/observability-compose.mjs ps
```

Wrapper luôn dùng project riêng `nrapp-observability`, không dùng chung
`COMPOSE_PROJECT_NAME` với backend nên lệnh `down` không chạm nhầm app/database.

Các cổng mặc định chỉ bind loopback:

- Grafana: <http://127.0.0.1:3001>
- Jaeger UI: <http://127.0.0.1:16686>
- Prometheus: <http://127.0.0.1:9090>
- Collector OTLP gRPC: `127.0.0.1:4317`
- Collector OTLP HTTP: `http://127.0.0.1:4318`
- Collector health: <http://127.0.0.1:13133>
- Loki readiness: <http://127.0.0.1:3100/ready>
- Alloy readiness: <http://127.0.0.1:12345/-/ready>

Grafana tự provision ba datasource `Prometheus`, `Jaeger`, `Loki`; Prometheus là
datasource mặc định. Dashboard `Infrastructure / Infrastructure overview` hiển
thị host, container, scrape target và sức khỏe Collector.

## Nối backend vào Collector

Compose tạo Docker network có tên cố định mặc định là `nrapp-observability`.
Compose chạy các backend phải khai báo network external cùng tên và nối các app
vào network đó. Trong container, cấu hình:

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Không dùng `localhost` trong app container vì đó là loopback của chính app.
Ứng dụng chạy trực tiếp trên host có thể dùng `http://127.0.0.1:4318`.

Nếu đổi `OBSERVABILITY_NETWORK_NAME` trong `logger/.env`, Compose backend cũng
phải dùng đúng tên đó.

## Metrics và alert rule

Prometheus scrape mỗi 15 giây:

- Prometheus, node-exporter và cAdvisor;
- Redis exporter, PostgreSQL exporter và RabbitMQ Prometheus plugin;
- OpenTelemetry Collector self-metrics và OTLP application metrics;
- Jaeger, Loki, Alloy và Grafana.

Rule cơ bản nằm tại `observability/prometheus/rules` gồm target down, CPU/RAM,
filesystem gần đầy, Collector drop/export-fail span, RabbitMQ backlog,
PostgreSQL connection saturation và Redis memory. Rule được đánh giá trong
Prometheus nhưng chưa có Alertmanager/contact point production; việc chọn nơi
nhận notification là quyết định vận hành riêng.

## Loki chỉ giữ system/infra log

Alloy chỉ discover container observability cùng PostgreSQL, Redis và RabbitMQ.
Log từ `gateway`, `auth`, `user`, `canteen`, `chat`, `todo`, `workschedule`,
`payment`, `mail` không còn được gửi vào pipeline Loki này.

Truy vấn system log trong Grafana Explore:

```logql
{log_scope="system"}
```

Request latency xem trong Jaeger; lỗi ứng dụng vẫn nằm ở structured
stdout/stderr và Docker local rotation theo policy của backend Compose.

## Kiểm tra nhanh

```bash
curl -fsS http://127.0.0.1:13133/
curl -fsS http://127.0.0.1:3100/ready
curl -fsS http://127.0.0.1:12345/-/ready
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:3001/api/health
docker compose logs --tail=100 otel-collector jaeger prometheus
```

Mở <http://127.0.0.1:9090/targets> để xác nhận các target đều `UP`. Nếu app
không có trace, kiểm tra app đã nối network `nrapp-observability`, endpoint OTLP
dùng DNS `otel-collector`, và Collector không báo refused/export failed.

Dừng mà giữ volume:

```bash
npm run observability:down
```

Chỉ thêm `--volumes` khi chủ động muốn xóa dữ liệu Prometheus/Loki/Grafana.

## Tài liệu chính thức

- [OpenTelemetry Collector Docker](https://opentelemetry.io/docs/collector/install/docker/)
- [OpenTelemetry Collector configuration](https://opentelemetry.io/docs/collector/configuration/)
- [Jaeger v2 getting started](https://www.jaegertracing.io/docs/2.20/getting-started/)
- [Prometheus node-exporter guide](https://prometheus.io/docs/guides/node-exporter/)
- [Prometheus cAdvisor guide](https://prometheus.io/docs/guides/cadvisor/)
- [Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)
