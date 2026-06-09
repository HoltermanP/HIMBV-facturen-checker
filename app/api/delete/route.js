// Een boeking of bon verwijderen. Bearer-auth op INTAKE_SECRET.
import { deleteTransaction, deleteDocument } from '../../../lib/db.js';

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
    return json({ error: 'verwacht JSON { txId } of { docId }' }, 400);
  }

  if (Number.isInteger(Number(body.txId))) {
    await deleteTransaction(Number(body.txId));
    return json({ status: 'ok' }, 200);
  }
  if (Number.isInteger(Number(body.docId))) {
    await deleteDocument(Number(body.docId));
    return json({ status: 'ok' }, 200);
  }
  return json({ error: 'geef txId of docId' }, 400);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
