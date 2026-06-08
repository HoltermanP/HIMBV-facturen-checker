// Volledigheidsrapport. Bearer-auth op INTAKE_SECRET.
// Geeft de "gaten" terug: uitgaven zonder bon, en bonnen zonder transactie.
import { missingReceipts, documentsWithoutTransaction } from '../../../lib/db.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.INTAKE_SECRET || token !== process.env.INTAKE_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  const missing = await missingReceipts();
  const docsWithout = await documentsWithoutTransaction();

  // Totaalbedrag van de ontbrekende bonnen (uitgaven zijn negatief).
  const missingTotal = missing.reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);

  return json(
    {
      missing,
      docsWithout,
      counts: {
        missing: missing.length,
        docsWithout: docsWithout.length,
        missingTotal: Math.round(missingTotal * 100) / 100,
      },
    },
    200,
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
