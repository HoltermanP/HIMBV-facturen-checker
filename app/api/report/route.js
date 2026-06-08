// Volledigheidsrapport. Bearer-auth op INTAKE_SECRET.
// Geeft openstaande uitgaven (met status), 'geen bon nodig'-lijst, bonnen zonder
// transactie, alle boekingen, en tellingen voor de statistiekblokken.
import {
  openExpenses,
  noneNeededExpenses,
  documentsWithoutTransaction,
  allTransactions,
  expenseStatusCounts,
} from '../../../lib/db.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.INTAKE_SECRET || token !== process.env.INTAKE_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  const [expenses, noneNeeded, docsWithout, all, counts] = await Promise.all([
    openExpenses(),
    noneNeededExpenses(),
    documentsWithoutTransaction(),
    allTransactions(),
    expenseStatusCounts(),
  ]);

  return json(
    {
      expenses,
      noneNeeded,
      docsWithout,
      all,
      counts: {
        open: counts.open,
        suggested: counts.suggested,
        noneNeeded: counts.none_needed,
        matched: counts.matched,
        docsWithout: docsWithout.length,
        openTotal: Math.round(Number(counts.open_total) * 100) / 100,
      },
    },
    200,
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
