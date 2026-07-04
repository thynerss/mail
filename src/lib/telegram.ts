import { env } from './env';
import type { InlineKeyboardButton } from './types';

const API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}`;

export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function keyboard(rows: InlineKeyboardButton[][]) {
  return { inline_keyboard: rows };
}

async function telegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
  }
  return json.result as T;
}

export async function sendMessage(
  chatId: number,
  text: string,
  options?: { reply_markup?: unknown; disable_web_page_preview?: boolean }
) {
  return telegram<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: options?.disable_web_page_preview ?? true,
    reply_markup: options?.reply_markup
  });
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
    // Telegram returns error if content is unchanged. Ignore that one.
    if (String(err.message).includes('message is not modified')) return null;
    throw err;
  });
}

export async function deleteMessage(chatId: number, messageId: number) {
  return telegram('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => null);
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
  if (arrayBuffer.byteLength > maxBytes) throw new Error('File too large. Max 1MB.');
  return Buffer.from(arrayBuffer).toString('utf8');
}
