-- RESET Outlook Mail Center Bot schema
-- DANGER: file này xoá toàn bộ dữ liệu bot cũ trong Supabase project hiện tại.
-- Chạy file này trước, sau đó chạy supabase/schema.sql.

drop table if exists telegram_message_logs cascade;
drop table if exists broadcasts cascade;
drop table if exists bot_logs cascade;
drop table if exists check_events cascade;
drop table if exists processed_messages cascade;
drop table if exists mail_accounts cascade;
drop table if exists user_states cascade;
drop table if exists bot_users cascade;

drop function if exists set_updated_at() cascade;

drop type if exists user_state_kind cascade;
drop type if exists token_status cascade;
drop type if exists bot_user_status cascade;
drop type if exists bot_role cascade;
