import { env } from './env';
import { supabase } from './supabase';
import type { InlineKeyboardButton } from './types';

const API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}`;

export function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function keyboard(rows: InlineKeyboardButton[][]) {
  return { inline_keyboard: rows };
}

async function telegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
  }
  return json.result as T;
}

export async function trackTelegramMessage(input: {
  chatId: number;
  messageId: number;
  direction: 'bot' | 'user';
  purpose?: string;
  ownerUserId?: string | null;
}) {
  try {
    await supabase.from('telegram_message_logs').insert({
      owner_user_id: input.ownerUserId ?? null,
      chat_id: input.chatId,
      message_id: input.messageId,
      direction: input.direction,
      purpose: input.purpose ?? null
    });
  } catch {
    // Message logging must never break bot delivery.
  }
}

export async function sendMessage(
  chatId: number,
  text: string,
  options?: { reply_markup?: unknown; disable_web_page_preview?: boolean; purpose?: string; owner_user_id?: string | null }
) {
  const result = await telegram<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: options?.disable_web_page_preview ?? true,
    reply_markup: options?.reply_markup
  });
  await trackTelegramMessage({
    chatId,
    messageId: result.message_id,
    direction: 'bot',
    purpose: options?.purpose,
    ownerUserId: options?.owner_user_id ?? null
  });
  return result;
}

export async function editMessage(
  chatId: number,
  messageId: number,
  text: string,
  options?: { reply_markup?: unknown }
) {
  return telegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: options?.reply_markup
  }).catch(async (err) => {
    if (String(err.message).includes('message is not modified')) return null;
    throw err;
  });
}

export async function deleteMessage(chatId: number, messageId: number) {
  const result = await telegram('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => null);
  if (result !== null) {
    try {
      await supabase
        .from('telegram_message_logs')
        .update({ deleted_at: new Date().toISOString() })
        .eq('chat_id', chatId)
        .eq('message_id', messageId);
    } catch {
      // Ignore log update failures.
    }
  }
  return result;
}

export async function cleanupRecentMessages(chatId: number, limit = env.CLEANUP_MESSAGE_LIMIT) {
  const { data } = await supabase
    .from('telegram_message_logs')
    .select('message_id')
    .eq('chat_id', chatId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  let deleted = 0;
  for (const row of data ?? []) {
    const ok = await deleteMessage(chatId, Number((row as { message_id: number }).message_id));
    if (ok !== null) deleted += 1;
  }
  return deleted;
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false) {
  return telegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert
  }).catch(() => null);
}

export async function getFileText(fileId: string): Promise<string> {
  const file = await telegram<{ file_path: string }>('getFile', { file_id: fileId });
  const res = await fetch(`${FILE_API}/${file.file_path}`);
  if (!res.ok) throw new Error(`Cannot download Telegram file: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const maxBytes = 1024 * 1024;
  if (arrayBuffer.byteLength > maxBytes) throw new Error('File quá lớn. Tối đa 1MB.');
  return Buffer.from(arrayBuffer).toString('utf8');
}
