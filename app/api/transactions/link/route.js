// Handmatig een bon aan een transactie koppelen (of ontkoppelen), met het
// bedragverschil weggeschreven. Bearer-auth op INTAKE_SECRET.
import { linkManual, unlinkByDoc, unlinkByTx } from '../../../../lib/db.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function POST(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.INTAKE_SECRET || token !== process.env.INTAKE_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'verwacht JSON' }, 400);
  }

  // Ontkoppelen.
  if (body.unlink) {
    if (Number.isInteger(Number(body.docId))) await unlinkByDoc(Number(body.docId));
    else if (Number.isInteger(Number(body.txId))) await unlinkByTx(Number(body.txId));
    else return json({ error: 'geef docId of txId' }, 400);
    return json({ status: 'ok' }, 200);
  }

  // Koppelen.
  const docId = Number(body.docId);
  const txId = Number(body.txId);
  if (!Number.isInteger(docId) || !Number.isInteger(txId)) {
    return json({ error: 'ongeldige docId/txId' }, 400);
  }
  const res = await linkManual(docId, txId);
  if (!res) return json({ error: 'document of transactie niet gevonden' }, 404);
  return json({ status: 'ok', diff: res.diff }, 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
