// Tijdelijk diagnose-endpoint: toont ruwe databasestaat (auth via INTAKE_SECRET).
import { debugCounts } from '../../../lib/db.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.INTAKE_SECRET || token !== process.env.INTAKE_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  // Toon ook welke DB-host de live app gebruikt (gemaskeerd), om branches te onderscheiden.
  const url = process.env.DATABASE_URL || '';
  const host = (url.match(/@([^/:]+)/) || [])[1] || 'onbekend';

  const data = await debugCounts();
  return json({ db_host: host, ...data }, 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
