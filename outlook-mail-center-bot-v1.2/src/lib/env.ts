import { z } from 'zod';

const boolish = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}, z.boolean());

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8),
  OWNER_TELEGRAM_ID: z.string().regex(/^\d+$/),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  TOKEN_ENCRYPTION_KEY_HEX: z.string().regex(/^[a-fA-F0-9]{64}$/),
  CRON_SECRET: z.string().optional(),

  // Microsoft Graph: v1.2 defaults to read-only because many existing refresh tokens
  // were granted Mail.Read but not Mail.ReadWrite. Enable write actions only when
  // your refresh tokens were issued with Mail.ReadWrite consent.
  MICROSOFT_GRAPH_SCOPES: z.string().min(1).default('offline_access Mail.Read'),
  ENABLE_WRITE_ACTIONS: boolish.default(false),

  MAX_MAIL_PER_USER: z.coerce.number().int().positive().default(100),
  MAX_IMPORT_PER_BATCH: z.coerce.number().int().positive().default(100),
  CHECK_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(8),
  MAX_CHECK_PER_HOUR: z.coerce.number().int().positive().default(30),
  FETCH_LATEST_MESSAGES: z.coerce.number().int().positive().max(25).default(10),
  MAX_RETURN_MESSAGES_PER_CHECK: z.coerce.number().int().positive().max(5).default(3),
  CLEANUP_MESSAGE_LIMIT: z.coerce.number().int().positive().max(100).default(35)
});

export const env = envSchema.parse(process.env);
export const OWNER_TELEGRAM_ID_NUM = Number(env.OWNER_TELEGRAM_ID);
