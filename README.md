# Outlook Mail Center Bot VIP v1.2

Bot Telegram quản lý nhiều Outlook/Hotmail theo mô hình **OWNER / USER**, tối ưu cho Vercel Free + Supabase Free.

## Điểm nâng cấp v1.2

- Fix lỗi Microsoft `AADSTS70000` do scope: mặc định chỉ dùng `offline_access Mail.Read`.
- Không còn yêu cầu `Mail.ReadWrite` khi chỉ check mail/lấy OTP.
- Nút đánh dấu đã đọc/xoá email thật bị ẩn mặc định. Chỉ bật khi `ENABLE_WRITE_ACTIONS=true` và refresh token có `Mail.ReadWrite`.
- Import mail có bước preview trước khi lưu.
- Thêm dọn dẹp tin nhắn thao tác với bot: `/clean` hoặc nút `🧹 Dọn tin bot`.
- Thêm bảng `telegram_message_logs` để bot nhớ các tin đã gửi và xoá hàng loạt.
- Giữ nguyên nguyên tắc: không check all, không theo dõi liên tục, user nào add mail thì mail đó thuộc user đó.

## ENV cần có trên Vercel

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=thiphan123
OWNER_TELEGRAM_ID=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
TOKEN_ENCRYPTION_KEY_HEX=
CRON_SECRET=thiphanxyz

MICROSOFT_GRAPH_SCOPES=offline_access Mail.Read
ENABLE_WRITE_ACTIONS=false

MAX_MAIL_PER_USER=100
MAX_IMPORT_PER_BATCH=100
CHECK_COOLDOWN_SECONDS=8
MAX_CHECK_PER_HOUR=30
FETCH_LATEST_MESSAGES=10
MAX_RETURN_MESSAGES_PER_CHECK=3
CLEANUP_MESSAGE_LIMIT=35
```

Tạo `TOKEN_ENCRYPTION_KEY_HEX`:

```bash
openssl rand -hex 32
```

## Reset Supabase SQL

Nếu bạn muốn xoá sạch schema cũ:

1. Chạy `supabase/reset_schema.sql`
2. Chạy `supabase/schema.sql`

Lưu ý: reset sẽ xoá dữ liệu bot cũ.

## Deploy

```bash
git add .
git commit -m "Upgrade Outlook Mail Center Bot v1.2"
git push
```

Vercel sẽ tự deploy lại repo GitHub.

## Set webhook

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://YOUR_DOMAIN.vercel.app/api/telegram?secret=$TELEGRAM_WEBHOOK_SECRET"
```

Kiểm tra:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

## Dùng bot

- `/start` mở menu.
- `/addmail` thêm mail hoặc upload file `.txt`.
- `/listmail` chọn đúng 1 mail rồi check.
- `/clean` dọn các tin bot/thao tác gần đây.
- OWNER: `/adduser TELEGRAM_ID`, `/revokeuser TELEGRAM_ID`, `/listuser`, `/broadcast`.

## Về Microsoft scope

Bản v1.2 mặc định chỉ đọc mail:

```env
MICROSOFT_GRAPH_SCOPES=offline_access Mail.Read
ENABLE_WRITE_ACTIONS=false
```

Nếu muốn đánh dấu đã đọc/xoá email thật, token Microsoft phải được cấp `Mail.ReadWrite`, sau đó đổi ENV:

```env
MICROSOFT_GRAPH_SCOPES=offline_access Mail.Read Mail.ReadWrite
ENABLE_WRITE_ACTIONS=true
```

Nếu token chưa có `Mail.ReadWrite`, Microsoft sẽ báo scope unauthorized/expired.
