import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { addUserByTelegramId, clearUserState, getUserState, isOwner, listUsers, requireUser, revokeUserByTelegramId, setUserState } from '@/lib/auth';
import { answerCallbackQuery, cleanupRecentMessages, deleteMessage, editMessage, getFileText, keyboard, sendMessage, trackTelegramMessage } from '@/lib/telegram';
import { addMailPrompt, checkedMessageText, checkResultText, deleteConfirmKeyboard, helpText, importPreviewText, importSummaryText, inboxText, mailDetail, mailListKeyboard, mailListText, mainMenu, usersText } from '@/lib/ui';
import { checkMailAccount, deleteMailAccount, deleteProcessedMessage, exportMyAccounts, getMailAccountForUser, importMailAccounts, inboxPreview, listMailAccounts, logEvent, markProcessedMessageRead, previewMailImport } from '@/lib/mailService';
import { supabase } from '@/lib/supabase';
import type { BotUser, TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeCode(input: string) {
  return input.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function getChatId(message?: TelegramMessage, cb?: TelegramCallbackQuery): number | null {
  return message?.chat.id ?? cb?.message?.chat.id ?? null;
}

function parseCommand(text: string): { cmd: string; args: string[] } {
  const [cmdRaw, ...args] = text.trim().split(/\s+/);
  return { cmd: cmdRaw.toLowerCase().split('@')[0], args };
}

async function getMailCount(userId: string) {
  const { count } = await supabase
    .from('mail_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('owner_user_id', userId)
    .is('deleted_at', null);
  return count ?? 0;
}

async function sendHome(chatId: number, user: BotUser, editMessageId?: number) {
  const view = mainMenu(user, { mailCount: await getMailCount(user.id) });
  if (editMessageId) return editMessage(chatId, editMessageId, view.text, { reply_markup: view.reply_markup });
  return sendMessage(chatId, view.text, { reply_markup: view.reply_markup, owner_user_id: user.id, purpose: 'menu' });
}

async function requireActive(update: TelegramUpdate): Promise<{ user: BotUser; chatId: number } | null> {
  const from = update.message?.from ?? update.callback_query?.from;
  const chatId = getChatId(update.message, update.callback_query);
  if (!from || !chatId) return null;
  const user = await requireUser(from);
  if (!user) {
    await sendMessage(chatId, '⛔ Bạn chưa được cấp quyền sử dụng bot. Hãy gửi Telegram ID của bạn cho OWNER để được cấp quyền.', { purpose: 'unauthorized' });
    return null;
  }
  return { user, chatId };
}

async function sendLong(chatId: number, html: string) {
  let rest = html;
  while (rest.length > 3900) {
    await sendMessage(chatId, rest.slice(0, 3900));
    rest = rest.slice(3900);
  }
  if (rest) await sendMessage(chatId, rest);
}

async function handleOwnerCommand(chatId: number, user: BotUser, text: string) {
  const { cmd, args } = parseCommand(text);
  if (!isOwner(user)) return false;

  if (cmd === '/adduser' || cmd === '/restoreuser') {
    const telegramId = Number(args[0]);
    if (!Number.isFinite(telegramId)) {
      await sendMessage(chatId, 'Sai cú pháp. Dùng: <code>/adduser TELEGRAM_ID</code>', { owner_user_id: user.id });
      return true;
    }
    const added = await addUserByTelegramId(user, telegramId);
    await sendMessage(chatId, `✅ Đã cấp quyền USER cho <code>${added.telegram_id}</code>.`, { owner_user_id: user.id });
    return true;
  }

  if (cmd === '/revokeuser') {
    const telegramId = Number(args[0]);
    if (!Number.isFinite(telegramId)) {
      await sendMessage(chatId, 'Sai cú pháp. Dùng: <code>/revokeuser TELEGRAM_ID</code>', { owner_user_id: user.id });
      return true;
    }
    const revoked = await revokeUserByTelegramId(telegramId);
    await sendMessage(chatId, revoked ? `🚫 Đã thu hồi quyền <code>${telegramId}</code>.` : 'Không tìm thấy user.', { owner_user_id: user.id });
    return true;
  }

  if (cmd === '/listuser' || cmd === '/users') {
    const users = await listUsers();
    await sendMessage(chatId, usersText(users), { owner_user_id: user.id });
    return true;
  }

  if (cmd === '/broadcast') {
    await setUserState(user.id, 'awaiting_broadcast');
    await sendMessage(chatId, '📢 Gửi nội dung thông báo tổng. Gõ /cancel để huỷ.', { owner_user_id: user.id });
    return true;
  }

  return false;
}

async function broadcastToUsers(owner: BotUser, body: string, ownerChatId: number) {
  const users = await listUsers();
  let sent = 0;
  let failed = 0;
  const text = `📢 <b>THÔNG BÁO HỆ THỐNG</b>\n\n${escapeCode(body)}`;
  for (const target of users.filter((u) => u.status === 'active')) {
    try {
      await sendMessage(target.telegram_id, text, { purpose: 'broadcast' });
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  await supabase.from('broadcasts').insert({ owner_user_id: owner.id, body, sent_count: sent, failed_count: failed });
  await sendMessage(ownerChatId, `✅ Broadcast hoàn tất.\n\nGửi thành công: <b>${sent}</b>\nLỗi: <b>${failed}</b>`, { owner_user_id: owner.id });
}

async function handleAddMailPayload(chatId: number, user: BotUser, update: TelegramUpdate) {
  let payload = update.message?.text?.trim() ?? '';
  if (!payload && update.message?.document?.file_id) {
    const fileName = update.message.document.file_name ?? '';
    if (!fileName.toLowerCase().endsWith('.txt')) {
      await sendMessage(chatId, '❌ Chỉ hỗ trợ file .txt.', { owner_user_id: user.id });
      return;
    }
    payload = await getFileText(update.message.document.file_id);
  }
  if (!payload) {
    await sendMessage(chatId, 'Hãy gửi text hoặc upload file .txt chứa danh sách mail.', { owner_user_id: user.id });
    return;
  }

  const preview = await previewMailImport(user, payload);
  await setUserState(user.id, 'awaiting_import_confirm', { payload });
  await sendMessage(chatId, importPreviewText(preview), {
    owner_user_id: user.id,
    reply_markup: keyboard([[{ text: '✅ Xác nhận import', callback_data: 'mail:import_confirm' }, { text: '❌ Huỷ', callback_data: 'mail:import_cancel' }]])
  });
}

async function handleMessage(update: TelegramUpdate) {
  const ctx = await requireActive(update);
  if (!ctx || !update.message) return;
  const { user, chatId } = ctx;
  const text = update.message.text?.trim();

  if (text === '/cancel') {
    await clearUserState(user.id);
    await sendMessage(chatId, '✅ Đã huỷ thao tác hiện tại.', { owner_user_id: user.id });
    return;
  }

  if (text === '/clean') {
    const deleted = await cleanupRecentMessages(chatId, env.CLEANUP_MESSAGE_LIMIT);
    await sendMessage(chatId, `🧹 Đã dọn <b>${deleted}</b> tin nhắn gần đây của bot/cuộc thao tác.`, { owner_user_id: user.id, purpose: 'cleanup_result' });
    return;
  }

  if (text?.startsWith('/')) {
    if (text === '/start' || text === '/menu') {
      await clearUserState(user.id);
      return sendHome(chatId, user);
    }
    if (text === '/help') return sendMessage(chatId, helpText(), { owner_user_id: user.id, reply_markup: keyboard([[{ text: '🏠 Menu', callback_data: 'home' }]]) });
    if (text === '/addmail') {
      await setUserState(user.id, 'awaiting_add_mail');
      return sendMessage(chatId, addMailPrompt(), { owner_user_id: user.id, reply_markup: keyboard([[{ text: '❌ Huỷ', callback_data: 'home' }]]) });
    }
    if (text === '/listmail') {
      const accounts = await listMailAccounts(user, 0);
      return sendMessage(chatId, mailListText(accounts, 0), { owner_user_id: user.id, reply_markup: mailListKeyboard(accounts, 0) });
    }
    if (text === '/export') {
      const out = await exportMyAccounts(user);
      if (!out) return sendMessage(chatId, '📭 Bạn chưa có mail để export.', { owner_user_id: user.id });
      return sendLong(chatId, `📤 <b>EXPORT CỦA BẠN</b>\n\n<code>${escapeCode(out)}</code>`);
    }
    if (await handleOwnerCommand(chatId, user, text)) return;
    return sendMessage(chatId, 'Không rõ lệnh. Bấm /start để mở menu.', { owner_user_id: user.id });
  }

  const state = await getUserState(user.id);
  if (state?.state === 'awaiting_add_mail') return handleAddMailPayload(chatId, user, update);

  if (state?.state === 'awaiting_import_confirm') {
    await sendMessage(chatId, 'Bạn đang ở bước xác nhận import. Hãy bấm ✅ Xác nhận import hoặc /cancel.', { owner_user_id: user.id });
    return;
  }

  if (state?.state === 'awaiting_broadcast') {
    if (!isOwner(user)) {
      await clearUserState(user.id);
      await sendMessage(chatId, '⛔ Chỉ OWNER được gửi broadcast.', { owner_user_id: user.id });
      return;
    }
    if (!text) {
      await sendMessage(chatId, 'Hãy gửi nội dung text cho thông báo tổng.', { owner_user_id: user.id });
      return;
    }
    await setUserState(user.id, 'awaiting_broadcast', { body: text });
    await sendMessage(chatId, `📢 <b>PREVIEW BROADCAST</b>\n\n${escapeCode(text)}\n\nBạn xác nhận gửi cho toàn bộ user active?`, {
      owner_user_id: user.id,
      reply_markup: keyboard([[{ text: '✅ Gửi', callback_data: 'owner:broadcast_send' }, { text: '❌ Huỷ', callback_data: 'owner:broadcast_cancel' }]])
    });
    return;
  }

  await sendMessage(chatId, 'Bấm /start để mở menu.', { owner_user_id: user.id });
}

async function handleCallback(update: TelegramUpdate) {
  const cb = update.callback_query;
  if (!cb?.data || !cb.message) return;
  const ctx = await requireActive(update);
  if (!ctx) return;
  const { user, chatId } = ctx;
  const messageId = cb.message.message_id;
  const data = cb.data;
  await answerCallbackQuery(cb.id);

  if (data === 'home') return sendHome(chatId, user, messageId);
  if (data === 'help') return editMessage(chatId, messageId, helpText(), { reply_markup: keyboard([[{ text: '🏠 Menu', callback_data: 'home' }]]) });

  if (data === 'ui:cleanup') {
    await answerCallbackQuery(cb.id, 'Đang dọn tin nhắn...');
    const deleted = await cleanupRecentMessages(chatId, env.CLEANUP_MESSAGE_LIMIT);
    await sendMessage(chatId, `🧹 Đã dọn <b>${deleted}</b> tin nhắn gần đây.`, { owner_user_id: user.id, purpose: 'cleanup_result' });
    return;
  }

  if (data === 'mail:add') {
    await setUserState(user.id, 'awaiting_add_mail');
    return editMessage(chatId, messageId, addMailPrompt(), { reply_markup: keyboard([[{ text: '❌ Huỷ', callback_data: 'home' }]]) });
  }

  if (data === 'mail:import_cancel') {
    await clearUserState(user.id);
    return editMessage(chatId, messageId, '✅ Đã huỷ import.', { reply_markup: keyboard([[{ text: '🏠 Menu', callback_data: 'home' }]]) });
  }

  if (data === 'mail:import_confirm') {
    const state = await getUserState(user.id);
    const payload = String(state?.payload?.payload ?? '');
    if (!payload) return editMessage(chatId, messageId, 'Không tìm thấy dữ liệu import. Hãy /addmail lại.', { reply_markup: keyboard([[{ text: '➕ Add Mail', callback_data: 'mail:add' }]]) });
    await editMessage(chatId, messageId, '⏳ Đang import mail...');
    const summary = await importMailAccounts(user, payload);
    await clearUserState(user.id);
    return editMessage(chatId, messageId, importSummaryText(summary), { reply_markup: keyboard([[{ text: '📋 Mail List', callback_data: 'mail:list:0' }, { text: '🏠 Menu', callback_data: 'home' }]]) });
  }

  if (data.startsWith('mail:list:')) {
    const page = Number(data.split(':')[2] || 0);
    const accounts = await listMailAccounts(user, page);
    return editMessage(chatId, messageId, mailListText(accounts, page), { reply_markup: mailListKeyboard(accounts, page) });
  }

  if (data.startsWith('mail:view:')) {
    const accountId = data.split(':')[2];
    const account = await getMailAccountForUser(user, accountId);
    if (!account) return editMessage(chatId, messageId, '⛔ Không tìm thấy mail hoặc không có quyền.', { reply_markup: keyboard([[{ text: '⬅️ Mail List', callback_data: 'mail:list:0' }]]) });
    const view = mailDetail(account);
    return editMessage(chatId, messageId, view.text, { reply_markup: view.reply_markup });
  }

  if (data.startsWith('mail:check:')) {
    const accountId = data.split(':')[2];
    await editMessage(chatId, messageId, '⏳ Đang check mail này...\n\nBot chỉ quét 1 mail, không check all, không chạy nền.');
    try {
      const result = await checkMailAccount(user, accountId);
      await editMessage(chatId, messageId, checkResultText(result), {
        reply_markup: keyboard([[{ text: '🔁 Làm mới', callback_data: `mail:check:${accountId}` }, { text: '⬅️ Mail', callback_data: `mail:view:${accountId}` }], [{ text: '🧹 Dọn tin bot', callback_data: 'ui:cleanup' }]])
      });
      for (const item of result.sent) {
        const buttons = [];
        if (item.processedId && env.ENABLE_WRITE_ACTIONS) {
          buttons.push([
            { text: '✅ Đã đọc', callback_data: `msg:read:${item.processedId}` },
            { text: '🗑 Xoá mail thật', callback_data: `msg:delete_confirm:${item.processedId}` }
          ]);
        }
        buttons.push([{ text: '🧹 Ẩn thông báo', callback_data: 'msg:hide' }, { text: '📧 Mail', callback_data: `mail:view:${accountId}` }]);
        await sendMessage(chatId, checkedMessageText(result.account, item), { owner_user_id: user.id, purpose: 'checked_mail', reply_markup: keyboard(buttons) });
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return editMessage(chatId, messageId, `❌ Check lỗi:\n\n<code>${escapeCode(msg.slice(0, 1500))}</code>`, { reply_markup: keyboard([[{ text: '🔁 Thử lại', callback_data: `mail:check:${accountId}` }, { text: '⬅️ Mail', callback_data: `mail:view:${accountId}` }]]) });
    }
  }

  if (data.startsWith('mail:inbox:')) {
    const accountId = data.split(':')[2];
    await editMessage(chatId, messageId, '⏳ Đang lấy inbox gần đây...');
    try {
      const result = await inboxPreview(user, accountId);
      return editMessage(chatId, messageId, inboxText(result.account, result.messages), { reply_markup: keyboard([[{ text: '🔁 Làm mới', callback_data: `mail:inbox:${accountId}` }, { text: '⬅️ Mail', callback_data: `mail:view:${accountId}` }], [{ text: '🧹 Dọn tin bot', callback_data: 'ui:cleanup' }]]) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return editMessage(chatId, messageId, `❌ Inbox lỗi:\n\n<code>${escapeCode(msg.slice(0, 1500))}</code>`, { reply_markup: keyboard([[{ text: '⬅️ Mail', callback_data: `mail:view:${accountId}` }]]) });
    }
  }

  if (data.startsWith('mail:delete_confirm:')) {
    const accountId = data.split(':')[2];
    return editMessage(chatId, messageId, '⚠️ Bạn chắc chắn muốn xoá mail này khỏi bot?\n\nViệc này không xoá email trong Outlook, chỉ xoá cấu hình khỏi bot.', { reply_markup: deleteConfirmKeyboard(accountId) });
  }

  if (data.startsWith('mail:delete:')) {
    const accountId = data.split(':')[2];
    await deleteMailAccount(user, accountId);
    return editMessage(chatId, messageId, '✅ Đã xoá mail khỏi bot.', { reply_markup: keyboard([[{ text: '📋 Mail List', callback_data: 'mail:list:0' }, { text: '🏠 Menu', callback_data: 'home' }]]) });
  }

  if (data === 'mail:export') {
    const out = await exportMyAccounts(user);
    if (!out) return editMessage(chatId, messageId, '📭 Bạn chưa có mail để export.', { reply_markup: keyboard([[{ text: '🏠 Menu', callback_data: 'home' }]]) });
    await sendLong(chatId, `📤 <b>EXPORT CỦA BẠN</b>\n\n<code>${escapeCode(out)}</code>`);
    return;
  }

  if (data === 'msg:hide') {
    await deleteMessage(chatId, messageId);
    return;
  }

  if (data.startsWith('msg:read:')) {
    if (!env.ENABLE_WRITE_ACTIONS) return answerCallbackQuery(cb.id, 'Chức năng ghi mail đang tắt.', true);
    const processedId = data.split(':')[2];
    try {
      await markProcessedMessageRead(user, processedId);
      await answerCallbackQuery(cb.id, 'Đã đánh dấu mail là đã đọc.');
    } catch (err) {
      await answerCallbackQuery(cb.id, err instanceof Error ? err.message.slice(0, 180) : 'Lỗi', true);
    }
    return;
  }

  if (data.startsWith('msg:delete_confirm:')) {
    if (!env.ENABLE_WRITE_ACTIONS) return answerCallbackQuery(cb.id, 'Chức năng xoá mail thật đang tắt.', true);
    const processedId = data.split(':')[2];
    return editMessage(chatId, messageId, `${cb.message.text ?? 'Mail'}\n\n⚠️ Xác nhận xoá email thật khỏi Outlook/Hotmail?`, {
      reply_markup: keyboard([[{ text: '✅ Xoá thật', callback_data: `msg:delete:${processedId}` }, { text: '❌ Huỷ', callback_data: 'msg:hide' }]])
    });
  }

  if (data.startsWith('msg:delete:')) {
    if (!env.ENABLE_WRITE_ACTIONS) return answerCallbackQuery(cb.id, 'Chức năng xoá mail thật đang tắt.', true);
    const processedId = data.split(':')[2];
    try {
      await deleteProcessedMessage(user, processedId);
      await editMessage(chatId, messageId, '✅ Đã xoá email thật khỏi Outlook/Hotmail.');
    } catch (err) {
      await answerCallbackQuery(cb.id, err instanceof Error ? err.message.slice(0, 180) : 'Lỗi', true);
    }
    return;
  }

  if (data === 'owner:users') {
    if (!isOwner(user)) return editMessage(chatId, messageId, '⛔ Chỉ OWNER được dùng chức năng này.');
    const users = await listUsers();
    return editMessage(chatId, messageId, usersText(users), { reply_markup: keyboard([[{ text: '🏠 Menu', callback_data: 'home' }]]) });
  }

  if (data === 'owner:broadcast') {
    if (!isOwner(user)) return editMessage(chatId, messageId, '⛔ Chỉ OWNER được dùng chức năng này.');
    await setUserState(user.id, 'awaiting_broadcast');
    return editMessage(chatId, messageId, '📢 Gửi nội dung thông báo tổng. Gõ /cancel để huỷ.', { reply_markup: keyboard([[{ text: '❌ Huỷ', callback_data: 'home' }]]) });
  }

  if (data === 'owner:broadcast_cancel') {
    await clearUserState(user.id);
    return editMessage(chatId, messageId, '✅ Đã huỷ broadcast.', { reply_markup: keyboard([[{ text: '🏠 Menu', callback_data: 'home' }]]) });
  }

  if (data === 'owner:broadcast_send') {
    if (!isOwner(user)) return editMessage(chatId, messageId, '⛔ Chỉ OWNER được dùng chức năng này.');
    const state = await getUserState(user.id);
    const body = String(state?.payload?.body ?? '');
    if (!body) return editMessage(chatId, messageId, 'Không tìm thấy nội dung broadcast.', { reply_markup: keyboard([[{ text: '🏠 Menu', callback_data: 'home' }]]) });
    await clearUserState(user.id);
    await editMessage(chatId, messageId, '⏳ Đang gửi broadcast...');
    await broadcastToUsers(user, body, chatId);
    return;
  }
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const update = await req.json() as TelegramUpdate;
  const chatId = getChatId(update.message, update.callback_query);
  const user = update.message?.from ?? update.callback_query?.from;
  if (chatId && update.message?.message_id) {
    await trackTelegramMessage({ chatId, messageId: update.message.message_id, direction: 'user' });
  }

  try {
    if (update.callback_query) await handleCallback(update);
    else if (update.message) await handleMessage(update);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent({ level: 'error', action: 'telegram_route_error', message: msg, raw: { update_id: update.update_id, from: user?.id } }).catch(() => null);
    if (chatId) await sendMessage(chatId, `❌ Lỗi hệ thống:\n\n<code>${escapeCode(msg.slice(0, 1500))}</code>`).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, name: 'outlook-mail-center-bot-vip-v1.2' });
}
