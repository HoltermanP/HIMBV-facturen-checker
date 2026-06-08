// Zet de bon-status van een transactie (afvinken / goedkeuren / terugzetten).
// Bij 'none_needed' worden gelijksoortige open uitgaven voorgesteld als 'geen bon'.
import { setReceiptStatus, suggestSimilarOpen } from '../../../../lib/db.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ALLOWED = ['open', 'suggested_none', 'none_needed'];

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
    return json({ error: 'verwacht JSON { id, status }' }, 400);
  }

  const id = Number(body.id);
  const status = body.status;
  if (!Number.isInteger(id) || !ALLOWED.includes(status)) {
    return json({ error: 'ongeldige id of status' }, 400);
  }

  await setReceiptStatus(id, status);

  // Afgevinkt als 'geen bon nodig' -> gelijksoortige open uitgaven voorstellen.
  let suggested = false;
  if (status === 'none_needed') {
    await suggestSimilarOpen(id);
    suggested = true;
  }

  return json({ status: 'ok', id, receipt_status: status, propagated: suggested }, 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
