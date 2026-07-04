import { OWNER_TELEGRAM_ID_NUM } from './env';
import { supabase } from './supabase';
import type { BotUser, TelegramUser } from './types';

export async function ensureOwner(from: TelegramUser): Promise<BotUser | null> {
  if (from.id !== OWNER_TELEGRAM_ID_NUM) return null;
  const existing = await getUserByTelegramId(from.id, false);
  if (existing) {
    if (existing.role !== 'owner' || existing.status !== 'active') {
      const { data, error } = await supabase
        .from('bot_users')
        .update({ role: 'owner', status: 'active', revoked_at: null, username: from.username ?? null, first_name: from.first_name ?? null })
        .eq('telegram_id', from.id)
        .select('*')
        .single();
      if (error) throw error;
      return data as BotUser;
    }
    return existing;
  }

  const { data, error } = await supabase
    .from('bot_users')
    .insert({
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      role: 'owner',
      status: 'active'
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as BotUser;
}

export async function getUserByTelegramId(telegramId: number, activeOnly = true): Promise<BotUser | null> {
  let query = supabase.from('bot_users').select('*').eq('telegram_id', telegramId).limit(1).maybeSingle();
  const { data, error } = await query;
  if (error) throw error;
  const user = data as BotUser | null;
  if (!user) return null;
  if (activeOnly && user.status !== 'active') return null;
  return user;
}

export async function requireUser(from: TelegramUser): Promise<BotUser | null> {
  const owner = await ensureOwner(from);
  if (owner) return owner;
  return getUserByTelegramId(from.id, true);
}

export function isOwner(user: BotUser): boolean {
  return user.role === 'owner';
}

export async function setUserState(userId: string, state: string, payload: Record<string, unknown> = {}) {
  const { error } = await supabase
    .from('user_states')
    .upsert({ user_id: userId, state, payload, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function getUserState(userId: string): Promise<{ state: string; payload: Record<string, unknown> } | null> {
  const { data, error } = await supabase
    .from('user_states')
    .select('state,payload')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as { state: string; payload: Record<string, unknown> } | null;
}

export async function clearUserState(userId: string) {
  await setUserState(userId, 'idle', {});
}

export async function addUserByTelegramId(owner: BotUser, telegramId: number) {
  const existing = await getUserByTelegramId(telegramId, false);
  if (existing) {
    const { data, error } = await supabase
      .from('bot_users')
      .update({ status: 'active', role: existing.role === 'owner' ? 'owner' : 'user', revoked_at: null, created_by: owner.id })
      .eq('telegram_id', telegramId)
      .select('*')
      .single();
    if (error) throw error;
    return data as BotUser;
  }

  const { data, error } = await supabase
    .from('bot_users')
    .insert({ telegram_id: telegramId, role: 'user', status: 'active', created_by: owner.id })
    .select('*')
    .single();
  if (error) throw error;
  return data as BotUser;
}

export async function revokeUserByTelegramId(telegramId: number) {
  if (telegramId === OWNER_TELEGRAM_ID_NUM) throw new Error('Không thể thu hồi OWNER.');
  const { data, error } = await supabase
    .from('bot_users')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('telegram_id', telegramId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data as BotUser | null;
}

export async function listUsers() {
  const { data, error } = await supabase
    .from('bot_users')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data as BotUser[];
}
