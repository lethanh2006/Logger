# Backend observability

Stack này tách tín hiệu theo đúng mục đích:

- ứng dụng gửi trace/metric bằng OTLP tới OpenTelemetry Collector;
- Collector batch/retry trace sang Jaeger và expose OTLP metric để Prometheus
  scrape;
- Prometheus scrape host, container, dependency, application metrics và probe
  readiness của chín backend service;
- Grafana dùng Prometheus mặc định cho hạ tầng và Jaeger cho distributed trace;
- Alloy chuyển structured application log và system/infra log sang hai scope
  riêng trong Loki; Loki không được dùng để tính API latency.

Logger Express cũ đã được gỡ. Backend không POST log đồng bộ tới `/api/log`;
structured log đi thẳng ra `stdout`/`stderr`, được Alloy tail bất đồng bộ sang
Loki, còn trace/metric được export bất đồng bộ qua OpenTelemetry.

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

Grafana tự provision bốn datasource `Prometheus`, `Jaeger`, `Loki`,
`Alertmanager`; Prometheus là datasource mặc định. Dashboard hiện có:

- `Backend observability / Service reliability`: readiness, throughput,
  p95, 4xx/5xx, slow route, rejection và Collector;
- `Backend observability / Application logs`: structured log theo service,
  severity và liên kết `trace_id` sang Jaeger;
- `Infrastructure / Infrastructure overview`, `Container health` và
  `Backend dependencies`.

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
- Blackbox exporter probe readiness của chín backend service;
- OpenTelemetry Collector self-metrics và OTLP application metrics;
- Jaeger, Loki, Alloy và Grafana.

Hai nhóm rule tại `observability/prometheus/rules` gồm 17 cảnh báo cho target,
CPU/RAM/filesystem, Collector, RabbitMQ/PostgreSQL/Redis, readiness backend,
tỷ lệ 5xx, p95 latency, OOM/restart/throttling và pipeline application log.
Prometheus gửi alert sang Alertmanager; receiver mặc định là `noop`. Có thể bật
Discord với một webhook secret, hoặc Discord + Telegram với ba secret ở phần dưới.

## Loki tách application log và system/infra log

Alloy discover Docker và tách log thành hai scope. Chỉ `service`, `container`,
`compose_project`, `stream` và `log_scope` có cardinality thấp được index.
`request_id`, `trace_id`, `error.id`, route và dữ liệu JSON khác chỉ được parse
lúc query, không trở thành Loki indexed label.

Truy vấn application log:

```logql
{log_scope="application"} | json
```

Truy vấn system log trong Grafana Explore:

```logql
{log_scope="system"}
```

Request latency xem bằng Prometheus dashboard và trace waterfall trong Jaeger.
Lỗi ứng dụng vẫn đồng thời nằm ở structured stdout/stderr và Docker local
rotation theo policy của backend Compose. Trong Grafana, field `TraceID` của log
được link sang Jaeger; từ Jaeger cũng có thể mở log cùng `trace_id` trong Loki.

## Discord và Telegram

Receiver mặc định vẫn là `noop` để clone mới không vô tình gửi alert ra ngoài.
Nếu chỉ dùng Discord, tạo file `observability/alertmanager/secrets/discord_webhook_url`
chứa incoming webhook URL, bảo đảm container đọc được file, rồi đặt trong `logger/.env`:

```dotenv
ALERTMANAGER_CONFIG_FILE=./observability/alertmanager/discord.yaml
```

Để bật đồng thời Discord và Telegram, tạo đủ ba secret file theo
`observability/alertmanager/secrets/README.md`, rồi đặt trong `logger/.env`:

```dotenv
ALERTMANAGER_CONFIG_FILE=./observability/alertmanager/discord-telegram.yaml
```

Validate rồi recreate riêng Alertmanager (chạy từ thư mục `backend`; đổi
`discord.yaml` thành `discord-telegram.yaml` nếu dùng cả hai kênh):

```bash
docker run --rm --entrypoint /bin/amtool \
  -v "$PWD/logger/observability/alertmanager/discord.yaml:/etc/alertmanager/alertmanager.yaml:ro" \
  -v "$PWD/logger/observability/alertmanager/secrets:/run/secrets/alertmanager:ro" \
  prom/alertmanager:v0.34.0 check-config /etc/alertmanager/alertmanager.yaml
node scripts/observability-compose.mjs up -d --force-recreate --wait alertmanager
```

`amtool check-config` kiểm tra cú pháp; vẫn cần kiểm tra secret tồn tại, đọc được
và gửi thử để xác nhận webhook hoạt động.

### Gửi thử thông báo Discord

Chạy từ thư mục `backend` trên Linux. Lệnh tạo một alert thử trong Alertmanager,
tự hết hạn sau hai phút. Mỗi lần chạy dùng một `service` riêng để tạo nhóm mới:

```bash
node scripts/observability-compose.mjs exec -T alertmanager \
  amtool --alertmanager.url=http://127.0.0.1:9093 alert add \
  DiscordManualTest severity=warning team=backend \
  service="manual-test-$(date +%s)" \
  --end="$(date -u -d '+2 minutes' +%Y-%m-%dT%H:%M:%SZ)" \
  --annotation=summary='[TEST] Kiem tra thong bao Discord' \
  --annotation=description='Canh bao thu, khong phai su co backend.'
```

Discord sẽ nhận `FIRING` sau khoảng 30 giây (`group_wait`). Thông báo `RESOLVED`
được gửi ở chu kỳ cập nhật tiếp theo (`group_interval: 5m`), nên có thể cần chờ
vài phút sau khi alert hết hạn. Xem alert tại <http://127.0.0.1:9093> và kiểm tra
bộ đếm gửi/lỗi bằng:

```bash
curl -fsS http://127.0.0.1:9093/metrics | \
  rg '^alertmanager_notifications(_failed)?_total\{.*integration="discord"'
```

Đây là phép thử Alertmanager → Discord. Rule thật được kiểm tra tại
<http://127.0.0.1:9090/alerts>. Một dòng log `error` hoặc một request trả 500 riêng
lẻ chưa đủ kích hoạt các rule hiện tại: readiness phải lỗi liên tục 2 phút;
rule HTTP 5xx yêu cầu tỷ lệ lỗi trên 5% và lưu lượng trên 0,1 request/giây (tính
trong cửa sổ 5 phút), duy trì điều kiện đó 5 phút. Alert mới còn chờ `group_wait`
trước khi gửi. Application log vẫn được lưu ở Loki, nhưng hiện không có rule
gửi Discord cho từng dòng log lỗi.

## Kiểm tra nhanh

```bash
npm run observability:smoke

# Khi cả 9 backend service đang chạy, kiểm thêm readiness, metric và app log:
npm run observability:acceptance

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
