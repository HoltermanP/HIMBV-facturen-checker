// Import van een bankafschrift (CSV). Bearer-auth op INTAKE_SECRET.
// Parseert de CSV, slaat transacties idempotent op en draait daarna de matching.
import { parseBankCsv } from '../../../../lib/bankcsv.js';
import { insertTransaction } from '../../../../lib/db.js';
import { runMatching } from '../../../../lib/match.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.INTAKE_SECRET || token !== process.env.INTAKE_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let form;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'verwacht multipart/form-data met veld "file"' }, 400);
  }

  const file = form.get('file');
  if (!file || typeof file.text !== 'function') {
    return json({ error: 'geen CSV-bestand in veld "file"' }, 400);
  }

  let parsed;
  try {
    parsed = parseBankCsv(await file.text());
  } catch (err) {
    return json({ error: String(err.message || err) }, 400);
  }

  // Idempotent opslaan: tel nieuw vs. duplicaat.
  let imported = 0;
  let duplicates = 0;
  for (const t of parsed.rows) {
    const ins = await insertTransaction({ ...t, source_file: file.name || 'afschrift.csv' });
    if (ins) imported++;
    else duplicates++;
  }

  // Na import meteen koppelen aan bestaande bonnen.
  const matched = await runMatching();

  return json(
    {
      status: 'ok',
      parsed: parsed.rows.length,
      imported,
      duplicates,
      matched,
      warnings: parsed.warnings,
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
