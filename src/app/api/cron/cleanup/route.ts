import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { cleanupOldData, logEvent } from '@/lib/mailService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.nextUrl.searchParams.get('secret');
  if (env.CRON_SECRET && auth !== env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  await cleanupOldData();
  await logEvent({ action: 'cron_cleanup', message: 'Cleanup old check events and logs.' }).catch(() => null);
  return NextResponse.json({ ok: true });
}
