# Backend observability

Stack này thu thập stdout/stderr dạng JSON của `gateway`, `auth`, `user`,
`canteen` và `todo`, lưu vào Loki, rồi cung cấp dashboard và alert qua
Grafana. Alloy tìm container theo Docker Compose service label nên có thể chạy
song song với file `compose.yaml` ở thư mục backend cha mà không cần sửa compose
của từng service.

Ứng dụng Express cũ trong `src/index.js` và endpoint `/api/log` vẫn được giữ để
tương thích. Luồng observability mới không yêu cầu các service phải POST log tới
endpoint đó.

## Khởi động

Từ thư mục `logger`:

```bash
cp .env.example .env
```

Đổi `GRAFANA_ADMIN_PASSWORD` thành mật khẩu mạnh và điền Discord webhook thật
vào `GRAFANA_ALERT_WEBHOOK_URL`, sau đó chạy:

```bash
docker compose up -d
docker compose ps
```

Các cổng mặc định chỉ bind vào loopback:

- Grafana: <http://127.0.0.1:3001>
- Loki readiness: <http://127.0.0.1:3100/ready>
- Alloy readiness: <http://127.0.0.1:12345/-/ready>

Dashboard `Backend observability / Backend request lifecycle` được provision tự
động. Chọn service và nhập request ID vào biến `Request ID (regex)` để lần theo
một request qua các service.

## Truy vấn nhanh

Trong Grafana Explore, có thể dùng:

```logql
{service=~"gateway|auth|user|canteen|todo"} | json | requestId="<request-id>"
```

`requestId` và `userId` được giữ dưới dạng structured metadata, không dùng làm
Loki label để tránh cardinality cao. Label ổn định gồm `service`, `container` và
`event`. Loki giữ dữ liệu bảy ngày theo cấu hình mặc định của repo này.

## Alert

Grafana provision ba rule, đánh giá mỗi phút:

- Hơn 5 phản hồi HTTP 5xx trong 5 phút, kéo dài 5 phút.
- Có health/readiness request trả status từ 400 trở lên, kéo dài 1 phút.
- HTTP p95 latency lớn hơn 1.000 ms, kéo dài 5 phút.

Notification được group theo `alertname` và `service`, chờ 30 giây trước lần gửi
đầu, group lại sau 5 phút và nhắc lại tối đa mỗi 2 giờ. Sau khi cấu hình webhook,
dùng nút **Test** ở `Alerting > Contact points > backend-discord` để xác nhận
Discord nhận được thông báo. Không commit file `.env` hoặc webhook thật.

## Kiểm tra và xử lý sự cố

```bash
curl -fsS http://127.0.0.1:3100/ready
curl -fsS http://127.0.0.1:12345/-/ready
curl -fsS http://127.0.0.1:3001/api/health
docker compose logs --tail=100 loki alloy grafana
```

Nếu dashboard không có dữ liệu, xác nhận backend chạy bằng Docker Compose và
tên service là một trong năm tên được liệt kê ở trên. Alloy cần mount read-only
`/var/run/docker.sock`; quyền này cho phép đọc metadata và log của container nên
chỉ nên chạy stack trên Docker host tin cậy.

Dừng container mà vẫn giữ dữ liệu:

```bash
docker compose down
```

Chỉ thêm `--volumes` khi chủ động muốn xóa toàn bộ dữ liệu Loki/Grafana.
