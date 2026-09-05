# Alertmanager secrets

Thư mục này được mount read-only vào `/run/secrets/alertmanager`. Mọi file secret
đều bị Git ignore; không commit webhook URL, bot token hoặc chat ID.

Nếu chỉ dùng Discord, tạo file `discord_webhook_url` chứa Discord incoming
webhook URL và đặt trong `logger/.env`:

```dotenv
ALERTMANAGER_CONFIG_FILE=./observability/alertmanager/discord.yaml
```

Để bật đồng thời Discord và Telegram, tạo đủ ba file không có dòng trống thừa:

- `discord_webhook_url`: Discord incoming webhook URL;
- `telegram_bot_token`: token do BotFather cấp;
- `telegram_chat_id`: chat/group ID dạng số, thường là số âm với group.

Trên Linux, cho UID/GID `65534` của Alertmanager đọc file:

```bash
chmod 750 logger/observability/alertmanager/secrets
chmod 640 logger/observability/alertmanager/secrets/*
sudo chown -R "$(id -u):65534" logger/observability/alertmanager/secrets
```

Chỉ chọn cấu hình kết hợp khi đã tạo đủ ba file. Đặt trong `logger/.env`:

```dotenv
ALERTMANAGER_CONFIG_FILE=./observability/alertmanager/discord-telegram.yaml
```
