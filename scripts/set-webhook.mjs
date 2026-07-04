import process from 'node:process';

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const url = process.argv[2];

if (!token || !secret || !url) {
  console.error('Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/set-webhook.mjs https://YOUR_DOMAIN.vercel.app');
  process.exit(1);
}

const webhookUrl = `${url.replace(/\/$/, '')}/api/telegram?secret=${encodeURIComponent(secret)}`;
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: webhookUrl, drop_pending_updates: true })
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
