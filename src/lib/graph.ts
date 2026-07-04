import type { GraphMessage } from './types';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export async function refreshMicrosoftToken(clientId: string, refreshToken: string): Promise<TokenResult> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'offline_access Mail.Read Mail.ReadWrite'
  });

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new Error(`Microsoft token lỗi: ${msg}`);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in
  };
}

async function graphFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      prefer: 'IdType="ImmutableId"',
      ...(init?.headers || {})
    }
  });

  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(`Graph API lỗi: ${msg}`);
  }
  return json as T;
}

export async function listLatestInboxMessages(accessToken: string, top: number): Promise<GraphMessage[]> {
  const params = new URLSearchParams({
    '$top': String(top),
    '$orderby': 'receivedDateTime desc',
    '$select': 'id,internetMessageId,from,subject,bodyPreview,receivedDateTime,isRead'
  });
  const json = await graphFetch<{ value: GraphMessage[] }>(accessToken, `/me/mailFolders/inbox/messages?${params}`);
  return json.value ?? [];
}

export async function getMessage(accessToken: string, messageId: string): Promise<GraphMessage> {
  const params = new URLSearchParams({
    '$select': 'id,internetMessageId,from,subject,bodyPreview,receivedDateTime,isRead'
  });
  return graphFetch<GraphMessage>(accessToken, `/me/messages/${encodeURIComponent(messageId)}?${params}`);
}

export async function markMessageRead(accessToken: string, messageId: string) {
  await graphFetch(accessToken, `/me/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isRead: true })
  });
}

export async function deleteMessageFromMailbox(accessToken: string, messageId: string) {
  await graphFetch(accessToken, `/me/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE'
  });
}
