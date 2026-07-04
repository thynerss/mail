export type BotRole = 'owner' | 'user';
export type BotUserStatus = 'active' | 'revoked';
export type UserStateKind = 'idle' | 'awaiting_add_mail' | 'awaiting_broadcast';

export interface BotUser {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  role: BotRole;
  status: BotUserStatus;
}

export interface MailAccount {
  id: string;
  owner_user_id: string;
  email: string;
  alias: string | null;
  client_id: string;
  refresh_token_encrypted: string;
  token_status: 'unknown' | 'ok' | 'error';
  last_seen_message_id: string | null;
  last_seen_received_at: string | null;
  last_check_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface GraphMessage {
  id: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  from?: {
    emailAddress?: {
      name?: string;
      address?: string;
    };
  };
}
