const emailRegex = /^[^\s@|]+@(hotmail\.com|outlook\.com|live\.com)$/i;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ParsedMailLine {
  email: string;
  refreshToken: string;
  clientId: string;
  raw: string;
}

export interface ParseResult {
  valid: ParsedMailLine[];
  invalid: Array<{ line: string; reason: string }>;
  duplicatesInFile: string[];
}

export function parseMailBulk(input: string, maxLines = 100): ParseResult {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);

  const valid: ParsedMailLine[] = [];
  const invalid: Array<{ line: string; reason: string }> = [];
  const seen = new Set<string>();
  const duplicatesInFile: string[] = [];

  for (const line of lines) {
    const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
    const email = parts.find((p) => emailRegex.test(p));
    const clientId = parts.find((p) => uuidRegex.test(p));

    if (!email) {
      invalid.push({ line, reason: 'Không tìm thấy email hotmail/outlook/live hợp lệ.' });
      continue;
    }
    if (!clientId) {
      invalid.push({ line, reason: 'Không tìm thấy client_id UUID hợp lệ.' });
      continue;
    }

    const refreshCandidates = parts.filter((p) => p !== email && p !== clientId);
    const refreshToken = refreshCandidates
      .filter((p) => p.length > 80)
      .sort((a, b) => b.length - a.length)[0];

    if (!refreshToken) {
      invalid.push({ line, reason: 'Không tìm thấy refresh token đủ dài.' });
      continue;
    }

    const normalized = email.toLowerCase();
    if (seen.has(normalized)) {
      duplicatesInFile.push(normalized);
      continue;
    }
    seen.add(normalized);

    valid.push({ email: normalized, refreshToken, clientId, raw: line });
  }

  return { valid, invalid, duplicatesInFile };
}
