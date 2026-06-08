// Volledigheidsrapport. Bearer-auth op INTAKE_SECRET.
// Openstaande posten (beide richtingen, met status), 'geen document nodig'-lijst,
// bonnen zonder transactie, alle boekingen, en tellingen voor de statistiekblokken.
import {
  openItems,
  noneNeededItems,
  documentsWithoutTransaction,
  allTransactions,
  itemStatusCounts,
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

  const [items, noneNeeded, docsWithout, all, counts] = await Promise.all([
    openItems(),
    noneNeededItems(),
    documentsWithoutTransaction(),
    allTransactions(),
    itemStatusCounts(),
  ]);

  return json(
    {
      items,
      noneNeeded,
      docsWithout,
      all,
      counts: {
        openOut: counts.open_out,
        openIn: counts.open_in,
        suggested: counts.suggested,
        noneNeeded: counts.none_needed,
        matched: counts.matched,
        docsWithout: docsWithout.length,
        outTotal: Math.round(Number(counts.out_total) * 100) / 100,
        inTotal: Math.round(Number(counts.in_total) * 100) / 100,
      },
    },
    200,
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
