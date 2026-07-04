import { env } from './env';
import { supabase } from './supabase';
import { encryptText, decryptText } from './crypto';
import { parseMailBulk, type ParseResult } from './parser';
import { deleteMessageFromMailbox, listLatestInboxMessages, markMessageRead, refreshMicrosoftToken } from './graph';
import { detectCode, scoreMessage } from './otp';
import type { BotUser, GraphMessage, MailAccount } from './types';

export interface ImportSummary {
  parse: ParseResult;
  inserted: number;
  duplicatesExisting: string[];
  failed: Array<{ email: string; reason: string }>;
}

export interface CheckedMessage {
  message: GraphMessage;
  codeHit: ReturnType<typeof detectCode>;
  processedId?: string;
}

export interface CheckResult {
  account: MailAccount;
  checkedAt: string;
  sent: CheckedMessage[];
  latestPreview?: GraphMessage;
  note: string;
}

export async function logEvent(input: {
  userId?: string;
  accountId?: string;
  level?: string;
  action: string;
  message?: string;
  raw?: Record<string, unknown>;
}) {
  await supabase.from('bot_logs').insert({
    owner_user_id: input.userId ?? null,
    account_id: input.accountId ?? null,
    level: input.level ?? 'info',
    action: input.action,
    message: input.message ?? null,
    raw: input.raw ?? {}
  });
}

export async function importMailAccounts(user: BotUser, text: string): Promise<ImportSummary> {
  const parse = parseMailBulk(text, env.MAX_IMPORT_PER_BATCH);

  const { count, error: countError } = await supabase
    .from('mail_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('owner_user_id', user.id)
    .is('deleted_at', null);
  if (countError) throw countError;

  const remaining = Math.max(0, env.MAX_MAIL_PER_USER - (count ?? 0));
  const toInsert = parse.valid.slice(0, remaining);
  const failed: Array<{ email: string; reason: string }> = [];
  if (parse.valid.length > remaining) {
    for (const item of parse.valid.slice(remaining)) failed.push({ email: item.email, reason: 'Vượt giới hạn mail của user.' });
  }

  let inserted = 0;
  const duplicatesExisting: string[] = [];

  for (const item of toInsert) {
    const { data: existing, error: existingError } = await supabase
      .from('mail_accounts')
      .select('id')
      .eq('owner_user_id', user.id)
      .eq('email', item.email)
      .is('deleted_at', null)
      .maybeSingle();
    if (existingError) {
      failed.push({ email: item.email, reason: existingError.message });
      continue;
    }
    if (existing) {
      duplicatesExisting.push(item.email);
      continue;
    }

    const { error } = await supabase.from('mail_accounts').insert({
      owner_user_id: user.id,
      email: item.email,
      client_id: item.clientId,
      refresh_token_encrypted: encryptText(item.refreshToken),
      token_status: 'unknown'
    });
    if (error) failed.push({ email: item.email, reason: error.message });
    else inserted += 1;
  }

  await logEvent({ userId: user.id, action: 'import_mail_accounts', raw: { inserted, invalid: parse.invalid.length, duplicatesExisting } });
  return { parse, inserted, duplicatesExisting, failed };
}

export async function listMailAccounts(user: BotUser, page = 0): Promise<MailAccount[]> {
  const from = page * 10;
  const to = from + 9;
  const { data, error } = await supabase
    .from('mail_accounts')
    .select('*')
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return data as MailAccount[];
}

export async function getMailAccountForUser(user: BotUser, accountId: string): Promise<MailAccount | null> {
  const { data, error } = await supabase
    .from('mail_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data as MailAccount | null;
}

export async function deleteMailAccount(user: BotUser, accountId: string) {
  const { error } = await supabase
    .from('mail_accounts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', accountId)
    .eq('owner_user_id', user.id)
    .is('deleted_at', null);
  if (error) throw error;
  await logEvent({ userId: user.id, accountId, action: 'delete_mail_account' });
}

async function enforceCheckRateLimit(user: BotUser, accountId: string) {
  const cooldownMs = env.CHECK_COOLDOWN_SECONDS * 1000;
  const { data: last, error: lastError } = await supabase
    .from('check_events')
    .select('created_at')
    .eq('owner_user_id', user.id)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;
  if (last?.created_at) {
    const diff = Date.now() - Date.parse(last.created_at);
    if (diff < cooldownMs) {
      const wait = Math.ceil((cooldownMs - diff) / 1000);
      throw new Error(`Vui lòng đợi ${wait}s rồi làm mới lại.`);
    }
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from('check_events')
    .select('*', { count: 'exact', head: true })
    .eq('owner_user_id', user.id)
    .gte('created_at', since);
  if (countError) throw countError;
  if ((count ?? 0) >= env.MAX_CHECK_PER_HOUR) {
    throw new Error(`Bạn đã đạt giới hạn ${env.MAX_CHECK_PER_HOUR} lượt check/giờ.`);
  }

  const { error } = await supabase.from('check_events').insert({ owner_user_id: user.id, account_id: accountId });
  if (error) throw error;
}

async function refreshForAccount(account: MailAccount): Promise<string> {
  const currentRefresh = decryptText(account.refresh_token_encrypted);
  const token = await refreshMicrosoftToken(account.client_id, currentRefresh);
  const update: Record<string, unknown> = {
    token_status: 'ok',
    last_error: null
  };
  if (token.refreshToken && token.refreshToken !== currentRefresh) {
    update.refresh_token_encrypted = encryptText(token.refreshToken);
  }
  await supabase.from('mail_accounts').update(update).eq('id', account.id);
  return token.accessToken;
}

export async function checkMailAccount(user: BotUser, accountId: string): Promise<CheckResult> {
  await enforceCheckRateLimit(user, accountId);

  const account = await getMailAccountForUser(user, accountId);
  if (!account) throw new Error('Không tìm thấy mail hoặc bạn không có quyền thao tác mail này.');

  const checkedAt = new Date().toISOString();

  try {
    const accessToken = await refreshForAccount(account);
    const messages = await listLatestInboxMessages(accessToken, env.FETCH_LATEST_MESSAGES);
    const latestPreview = messages[0];

    if (messages.length === 0) {
      await supabase.from('mail_accounts').update({ last_check_at: checkedAt }).eq('id', account.id);
      return { account, checkedAt, sent: [], note: 'Inbox trống.' };
    }

    const ids = messages.map((m) => m.id);
    const { data: processed, error: processedError } = await supabase
      .from('processed_messages')
      .select('message_id')
      .eq('account_id', account.id)
      .in('message_id', ids);
    if (processedError) throw processedError;
    const processedIds = new Set((processed ?? []).map((row: { message_id: string }) => row.message_id));

    const baselineMs = account.last_seen_received_at ? Date.parse(account.last_seen_received_at) : 0;
    const firstRun = !account.last_seen_received_at;
    const now = Date.now();

    const candidates = messages
      .filter((message) => !processedIds.has(message.id))
      .filter((message) => {
        const receivedMs = message.receivedDateTime ? Date.parse(message.receivedDateTime) : 0;
        if (baselineMs) return receivedMs > baselineMs;
        // First run: allow recent messages only, otherwise bootstrap baseline silently.
        return receivedMs >= now - 30 * 60 * 1000;
      })
      .map((message) => ({ message, codeHit: detectCode(message), rank: scoreMessage(message) }))
      .sort((a, b) => b.rank - a.rank || Date.parse(b.message.receivedDateTime ?? '0') - Date.parse(a.message.receivedDateTime ?? '0'))
      .slice(0, env.MAX_RETURN_MESSAGES_PER_CHECK);

    const newestReceived = messages
      .map((m) => m.receivedDateTime)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const newestMessage = messages
      .slice()
      .sort((a, b) => Date.parse(b.receivedDateTime ?? '0') - Date.parse(a.receivedDateTime ?? '0'))[0];

    const checkedMessages: CheckedMessage[] = [];
    if (candidates.length > 0) {
      for (const item of candidates) {
        const { data: inserted, error: insertError } = await supabase.from('processed_messages').insert({
          owner_user_id: user.id,
          account_id: account.id,
          message_id: item.message.id,
          internet_message_id: item.message.internetMessageId ?? null,
          sender_name: item.message.from?.emailAddress?.name ?? null,
          sender_email: item.message.from?.emailAddress?.address ?? null,
          subject: item.message.subject ?? null,
          preview: item.message.bodyPreview ?? null,
          detected_code: item.codeHit.code,
          detected_type: item.codeHit.type,
          score: item.codeHit.score,
          received_at: item.message.receivedDateTime ?? null
        }).select('id').maybeSingle();

        let processedId = inserted?.id as string | undefined;
        if (insertError) {
          if (!insertError.message.toLowerCase().includes('duplicate')) throw insertError;
          const { data: existing } = await supabase
            .from('processed_messages')
            .select('id')
            .eq('account_id', account.id)
            .eq('message_id', item.message.id)
            .maybeSingle();
          processedId = existing?.id as string | undefined;
        }
        checkedMessages.push({ message: item.message, codeHit: item.codeHit, processedId });
      }
    }

    await supabase
      .from('mail_accounts')
      .update({
        last_check_at: checkedAt,
        last_seen_received_at: newestReceived,
        last_seen_message_id: newestMessage?.id ?? account.last_seen_message_id,
        token_status: 'ok',
        last_error: null
      })
      .eq('id', account.id);

    const note = candidates.length > 0
      ? `Tìm thấy ${candidates.length} mail mới/chưa xử lý.`
      : firstRun
        ? 'Đã khởi tạo mốc kiểm tra. Chưa thấy mail/code mới trong 30 phút gần đây.'
        : 'Chưa có mail mới hơn mốc đã xử lý.';

    await logEvent({ userId: user.id, accountId: account.id, action: 'check_mail', raw: { found: candidates.length } });
    return { account, checkedAt, sent: checkedMessages, latestPreview, note };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from('mail_accounts').update({ token_status: 'error', last_error: msg, last_check_at: checkedAt }).eq('id', account.id);
    await logEvent({ userId: user.id, accountId: account.id, level: 'error', action: 'check_mail_error', message: msg });
    throw err;
  }
}

export async function inboxPreview(user: BotUser, accountId: string): Promise<{ account: MailAccount; messages: GraphMessage[] }> {
  const account = await getMailAccountForUser(user, accountId);
  if (!account) throw new Error('Không tìm thấy mail hoặc bạn không có quyền thao tác mail này.');
  const accessToken = await refreshForAccount(account);
  const messages = await listLatestInboxMessages(accessToken, 5);
  await supabase.from('mail_accounts').update({ last_check_at: new Date().toISOString(), token_status: 'ok', last_error: null }).eq('id', account.id);
  return { account, messages };
}

export async function markProcessedMessageRead(user: BotUser, processedId: string) {
  const { data, error } = await supabase
    .from('processed_messages')
    .select('id, message_id, account_id, mail_accounts!inner(*)')
    .eq('id', processedId)
    .eq('owner_user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Không tìm thấy mail đã xử lý.');
  const account = (data as any).mail_accounts as MailAccount;
  const accessToken = await refreshForAccount(account);
  await markMessageRead(accessToken, (data as any).message_id);
}

export async function deleteProcessedMessage(user: BotUser, processedId: string) {
  const { data, error } = await supabase
    .from('processed_messages')
    .select('id, message_id, account_id, mail_accounts!inner(*)')
    .eq('id', processedId)
    .eq('owner_user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Không tìm thấy mail đã xử lý.');
  const account = (data as any).mail_accounts as MailAccount;
  const accessToken = await refreshForAccount(account);
  await deleteMessageFromMailbox(accessToken, (data as any).message_id);
}

export async function exportMyAccounts(user: BotUser): Promise<string> {
  const { data, error } = await supabase
    .from('mail_accounts')
    .select('*')
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as MailAccount[])
    .map((a) => `${a.email}|${a.client_id}|${decryptText(a.refresh_token_encrypted)}`)
    .join('\n');
}

export async function cleanupOldData() {
  const oldChecks = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oldLogs = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('check_events').delete().lt('created_at', oldChecks);
  await supabase.from('bot_logs').delete().lt('created_at', oldLogs);
}
