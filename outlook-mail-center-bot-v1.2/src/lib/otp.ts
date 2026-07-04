import type { GraphMessage } from './types';

export interface CodeHit {
  code: string | null;
  type: string;
  score: number;
  confidence: 'Cao' | 'Trung bình' | 'Thấp';
}

const positiveKeywords = [
  'code', 'otp', 'verify', 'verification', 'security', 'login', 'sign in', 'single-use',
  'password reset', 'account', 'confirm', 'authenticate', 'mã', 'xác minh', 'bao mật',
  'bảo mật', 'đăng nhập', 'khôi phục', 'một lần'
];

const negativeKeywords = [
  'sale', 'promo', 'newsletter', 'unsubscribe', 'offer', 'discount', 'coupon',
  'khuyến mãi', 'giảm giá', 'bản tin'
];

const codePatterns = [
  /(?<!\d)(\d{6})(?!\d)/,
  /(?<!\d)(\d{8})(?!\d)/,
  /\b([A-Z0-9]{4}[-\s][A-Z0-9]{4})\b/i,
  /\b([A-Z]{2,4}[-]?\d{2,6})\b/i
];

export function detectCode(message: GraphMessage): CodeHit {
  const subject = message.subject ?? '';
  const preview = message.bodyPreview ?? '';
  const sender = message.from?.emailAddress?.address ?? '';
  const haystack = `${subject}\n${preview}\n${sender}`;
  const lower = haystack.toLowerCase();

  let score = 0;
  for (const kw of positiveKeywords) if (lower.includes(kw)) score += 20;
  for (const kw of negativeKeywords) if (lower.includes(kw)) score -= 25;
  if (sender.includes('noreply') || sender.includes('no-reply')) score += 10;
  if (sender.includes('security') || sender.includes('account')) score += 15;

  let code: string | null = null;
  for (const pattern of codePatterns) {
    const match = haystack.match(pattern);
    if (match?.[1]) {
      code = match[1].replace(/\s+/g, '-');
      score += 50;
      break;
    }
  }

  const hasVerifyLink = /https?:\/\/[^\s]+/i.test(haystack) && /(verify|confirm|login|security|reset|account)/i.test(haystack);
  if (!code && hasVerifyLink) score += 35;

  let type = 'Mail thường';
  if (code) type = 'OTP / Code';
  else if (hasVerifyLink) type = 'Link xác minh';
  else if (score >= 40) type = 'Xác minh / Bảo mật';

  let confidence: CodeHit['confidence'] = 'Thấp';
  if (score >= 70) confidence = 'Cao';
  else if (score >= 40) confidence = 'Trung bình';

  return { code, type, score, confidence };
}

export function scoreMessage(message: GraphMessage): number {
  const codeHit = detectCode(message);
  const receivedMs = message.receivedDateTime ? Date.parse(message.receivedDateTime) : 0;
  const ageMinutes = receivedMs ? Math.max(0, (Date.now() - receivedMs) / 60000) : 9999;
  const recencyScore = ageMinutes <= 10 ? 25 : ageMinutes <= 30 ? 10 : 0;
  return codeHit.score + recencyScore;
}
