# Outlook Mail Center Bot VIP v1.0

Telegram bot quản lý mail Outlook/Hotmail theo mô hình tối ưu cho Vercel Free:

- Chỉ có `OWNER` và `USER`.
- Mỗi user có workspace mail riêng.
- User tự add/check/export/xoá mail của chính họ.
- OWNER chỉ quản lý user và broadcast hệ thống.
- Không check all.
- Không theo dõi liên tục.
- Không giữ server chờ 5 phút.
- Cơ chế chính là `Smart Pull Check`: chọn 1 mail → bấm Check Mail → lấy Inbox mới nhất → chống trùng bằng DB.

## 1. Stack

- Next.js API Routes trên Vercel
- Supabase Postgres
- Telegram Bot Webhook
- Microsoft Graph API

## 2. Tạo Supabase

1. Tạo project Supabase.
2. Vào SQL Editor.
3. Chạy file:

```sql
supabase/schema.sql
```

## 3. Tạo ENV

Copy `.env.example` thành `.env.local` khi chạy local hoặc set Environment Variables trên Vercel.

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
OWNER_TELEGRAM_ID=...
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
TOKEN_ENCRYPTION_KEY_HEX=...
CRON_SECRET=...
```

Tạo encryption key:

```bash
openssl rand -hex 32
```

## 4. Deploy Vercel

```bash
npm install
npm run build
```

Sau khi deploy, set Telegram webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://YOUR_DOMAIN.vercel.app/api/telegram?secret=$TELEGRAM_WEBHOOK_SECRET"
```

## 5. Lệnh bot

User:

```text
/start
/addmail
/listmail
/export
/cancel
```

OWNER:

```text
/adduser TELEGRAM_ID
/revokeuser TELEGRAM_ID
/restoreuser TELEGRAM_ID
/listuser
/broadcast
```

## 6. Format add mail

Bot chấp nhận 2 format:

```text
email|password|refresh_token|client_id
email|refresh_token|client_id
```

Bot tự bỏ qua password và không lưu password.

## 7. Cơ chế chống trùng

Mỗi account lưu:

- `last_seen_message_id`
- `last_seen_received_at`

Mỗi mail đã gửi về Telegram lưu trong bảng:

- `processed_messages`

Unique key:

```sql
unique(account_id, message_id)
```

Nhờ vậy user bấm Làm mới nhiều lần vẫn không nhận trùng mail cũ.

## 8. Quyền riêng tư

Mọi bảng mail đều có `owner_user_id`.

Backend luôn check:

```text
account.owner_user_id === user.id
```

User khác không xem/thao tác mail của nhau. OWNER không có menu xem nội dung mail riêng tư của USER.

## 9. Ghi chú Microsoft Graph

Bot refresh access token bằng `refresh_token` + `client_id`, rồi gọi:

```http
GET /me/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime desc&$select=id,internetMessageId,from,subject,bodyPreview,receivedDateTime,isRead
```

Nếu token không có quyền `Mail.Read` hoặc `Mail.ReadWrite`, chức năng đọc/xoá/mark-read có thể lỗi. Khi đó cần cấp scope tương ứng lúc lấy refresh token.
