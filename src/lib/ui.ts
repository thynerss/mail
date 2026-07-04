import { env } from './env';
import { escapeHtml, keyboard } from './telegram';
import type { BotUser, GraphMessage, MailAccount } from './types';
import type { CheckedMessage, CheckResult, ImportSummary } from './mailService';

function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function shortEmail(email: string): string {
  return email.length > 34 ? `${email.slice(0, 31)}...` : email;
}

export function mainMenu(user: BotUser, stats?: { mailCount?: number }) {
  const owner = user.role === 'owner';
  const text = [
    '📬 <b>OUTLOOK MAIL CENTER</b>',
    '',
    `👤 User: <b>${escapeHtml(user.username ? '@' + user.username : user.first_name ?? user.telegram_id)}</b>`,
    `🧩 Vai trò: <b>${owner ? 'OWNER' : 'USER'}</b>`,
    `📧 Mail của bạn: <b>${stats?.mailCount ?? '—'}</b>`,
    '',
    'Chọn mail cụ thể rồi bấm <b>Check Mail</b>. Bot không check all, không theo dõi nền để tiết kiệm tài nguyên.'
  ].join('\n');

  const rows = [
    [
      { text: '📋 Mail List', callback_data: 'mail:list:0' },
      { text: '➕ Add Mail', callback_data: 'mail:add' }
    ],
    [
      { text: '📦 Add Bulk TXT', callback_data: 'mail:add' },
      { text: '📤 Export của tôi', callback_data: 'mail:export' }
    ],
    [
      { text: '❓ Hướng dẫn', callback_data: 'help' }
    ]
  ];

  if (owner) {
    rows.push([
      { text: '👥 User Manager', callback_data: 'owner:users' },
      { text: '📢 Broadcast', callback_data: 'owner:broadcast' }
    ]);
  }

  return { text, reply_markup: keyboard(rows) };
}

export function helpText() {
  return [
    '❓ <b>HƯỚNG DẪN NHANH</b>',
    '',
    '<b>Format add mail:</b>',
    '<code>email|password|refresh_token|client_id</code>',
    '<code>email|refresh_token|client_id</code>',
    '',
    'Bot tự bỏ qua password và không lưu password.',
    '',
    '<b>Luồng tối ưu:</b>',
    '1. Add mail',
    '2. Vào Mail List',
    '3. Chọn đúng 1 mail',
    '4. Bấm Check Mail hoặc Làm mới',
    '',
    `Rate limit mặc định: ${env.CHECK_COOLDOWN_SECONDS}s/lượt/mail, ${env.MAX_CHECK_PER_HOUR} lượt/giờ/user.`
  ].join('\n');
}

export function addMailPrompt() {
  return [
    '➕ <b>ADD MAIL</b>',
    '',
    'Gửi 1 dòng hoặc nhiều dòng theo format:',
    '',
    '<code>email|password|refresh_token|client_id</code>',
    '<code>email|refresh_token|client_id</code>',
    '',
    'Bạn cũng có thể upload file <b>.txt</b>.',
    '',
    '⚠️ Bot sẽ tự bỏ qua password và không lưu password.',
    '',
    'Gõ /cancel để huỷ.'
  ].join('\n');
}

export function importSummaryText(summary: ImportSummary) {
  return [
    '📦 <b>IMPORT HOÀN TẤT</b>',
    '',
    `✅ Đã thêm: <b>${summary.inserted}</b>`,
    `⚠️ Trùng trong file: <b>${summary.parse.duplicatesInFile.length}</b>`,
    `⚠️ Đã tồn tại: <b>${summary.duplicatesExisting.length}</b>`,
    `❌ Sai định dạng: <b>${summary.parse.invalid.length}</b>`,
    `❌ Lỗi lưu: <b>${summary.failed.length}</b>`,
    '',
    summary.parse.invalid.slice(0, 5).map((x) => `• ${escapeHtml(x.reason)}: <code>${escapeHtml(x.line.slice(0, 50))}</code>`).join('\n')
  ].filter(Boolean).join('\n');
}

export function mailListText(accounts: MailAccount[], page: number) {
  const lines = [
    '📋 <b>MAIL CỦA BẠN</b>',
    '',
    accounts.length === 0 ? 'Bạn chưa add mail nào.' : 'Chọn 1 mail để thao tác:'
  ];

  accounts.forEach((a, idx) => {
    const status = a.token_status === 'ok' ? '🟢' : a.token_status === 'error' ? '🔴' : '⚪';
    lines.push(`${page * 10 + idx + 1}. ${status} <code>${escapeHtml(shortEmail(a.email))}</code>`);
  });

  return lines.join('\n');
}

export function mailListKeyboard(accounts: MailAccount[], page: number) {
  const rows = accounts.map((a) => ([{ text: `${a.token_status === 'error' ? '🔴' : '📧'} ${shortEmail(a.email)}`, callback_data: `mail:view:${a.id}` }]));
  const nav = [];
  if (page > 0) nav.push({ text: '⬅️ Trang trước', callback_data: `mail:list:${page - 1}` });
  if (accounts.length === 10) nav.push({ text: '➡️ Trang sau', callback_data: `mail:list:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '🏠 Menu', callback_data: 'home' }, { text: '➕ Add Mail', callback_data: 'mail:add' }]);
  return keyboard(rows);
}

export function mailDetail(account: MailAccount) {
  const text = [
    `📧 <b>${escapeHtml(account.email)}</b>`,
    '',
    `Trạng thái token: <b>${account.token_status === 'ok' ? '🟢 OK' : account.token_status === 'error' ? '🔴 Lỗi' : '⚪ Chưa kiểm tra'}</b>`,
    `Check gần nhất: <b>${fmtDate(account.last_check_at)}</b>`,
    `Mốc mail cuối: <b>${fmtDate(account.last_seen_received_at)}</b>`,
    account.last_error ? `\nLỗi gần nhất: <code>${escapeHtml(account.last_error.slice(0, 300))}</code>` : '',
    '',
    'Chỉ check mail này, không check all.'
  ].filter(Boolean).join('\n');

  const reply_markup = keyboard([
    [{ text: '🔍 Check Mail', callback_data: `mail:check:${account.id}` }, { text: '📩 Inbox gần đây', callback_data: `mail:inbox:${account.id}` }],
    [{ text: '🔁 Làm mới', callback_data: `mail:check:${account.id}` }, { text: '🗑 Xoá khỏi bot', callback_data: `mail:delete_confirm:${account.id}` }],
    [{ text: '⬅️ Mail List', callback_data: 'mail:list:0' }, { text: '🏠 Menu', callback_data: 'home' }]
  ]);

  return { text, reply_markup };
}

export function checkResultText(result: CheckResult) {
  const lines = [
    `🔍 <b>CHECK MAIL</b>`,
    '',
    `📧 <code>${escapeHtml(result.account.email)}</code>`,
    `⏱ ${fmtDate(result.checkedAt)}`,
    '',
    escapeHtml(result.note)
  ];

  if (result.sent.length === 0 && result.latestPreview) {
    lines.push('', '📌 <b>Mail mới nhất trong Inbox:</b>');
    lines.push(formatMessageShort(result.latestPreview));
  }

  return lines.join('\n');
}

export function checkedMessageText(account: MailAccount, item: CheckedMessage) {
  const m = item.message;
  const code = item.codeHit.code ? `<code>${escapeHtml(item.codeHit.code)}</code>` : 'Không thấy mã rõ ràng';
  return [
    '📩 <b>MAIL MỚI / CHƯA XỬ LÝ</b>',
    '',
    `📧 <code>${escapeHtml(account.email)}</code>`,
    `👤 ${escapeHtml(m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Không rõ')}`,
    `📝 <b>${escapeHtml(m.subject || '(Không tiêu đề)')}</b>`,
    '',
    `🔐 Code: <b>${code}</b>`,
    `🏷 Loại: <b>${escapeHtml(item.codeHit.type)}</b>`,
    `🎯 Tin cậy: <b>${item.codeHit.confidence}</b>`,
    `⏰ ${fmtDate(m.receivedDateTime)}`,
    '',
    `<i>${escapeHtml((m.bodyPreview || '').slice(0, 500))}</i>`
  ].join('\n');
}

export function formatMessageShort(m: GraphMessage) {
  return [
    `👤 ${escapeHtml(m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Không rõ')}`,
    `📝 ${escapeHtml(m.subject || '(Không tiêu đề)')}`,
    `⏰ ${fmtDate(m.receivedDateTime)}`,
    `<i>${escapeHtml((m.bodyPreview || '').slice(0, 180))}</i>`
  ].join('\n');
}

export function inboxText(account: MailAccount, messages: GraphMessage[]) {
  const lines = [`📩 <b>INBOX GẦN ĐÂY</b>`, '', `📧 <code>${escapeHtml(account.email)}</code>`, ''];
  if (messages.length === 0) lines.push('Inbox trống.');
  messages.forEach((m, idx) => {
    lines.push(`<b>${idx + 1}. ${escapeHtml(m.subject || '(Không tiêu đề)')}</b>`);
    lines.push(`👤 ${escapeHtml(m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Không rõ')}`);
    lines.push(`⏰ ${fmtDate(m.receivedDateTime)}`);
    lines.push(`<i>${escapeHtml((m.bodyPreview || '').slice(0, 160))}</i>`);
    lines.push('');
  });
  return lines.join('\n');
}

export function usersText(users: BotUser[]) {
  const lines = ['👥 <b>USER MANAGER</b>', ''];
  users.forEach((u, idx) => {
    lines.push(`${idx + 1}. ${u.role === 'owner' ? '🛡' : '👤'} <code>${u.telegram_id}</code> — ${escapeHtml(u.username ? '@' + u.username : u.first_name ?? '')} — <b>${u.status}</b>`);
  });
  lines.push('', 'Lệnh:', '<code>/adduser TELEGRAM_ID</code>', '<code>/revokeuser TELEGRAM_ID</code>', '<code>/restoreuser TELEGRAM_ID</code>');
  return lines.join('\n');
}

export function deleteConfirmKeyboard(accountId: string) {
  return keyboard([
    [{ text: '✅ Xoá khỏi bot', callback_data: `mail:delete:${accountId}` }, { text: '❌ Huỷ', callback_data: `mail:view:${accountId}` }]
  ]);
}
