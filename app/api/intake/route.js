// Handmatige intake: foto vanaf iPhone of upload(s) vanaf laptop.
// POST multipart/form-data met één of meer velden "file". Bearer-auth op INTAKE_SECRET.
import { processAttachment, processableReason, UPLOAD_MIN_BYTES } from '../../../lib/process.js';
import { runMatching } from '../../../lib/match.js';
import { classifyByRules } from '../../../lib/db.js';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

export async function POST(req) {
  // Auth: Bearer INTAKE_SECRET.
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.INTAKE_SECRET || token !== process.env.INTAKE_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let form;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'verwacht multipart/form-data' }, 400);
  }

  const files = form.getAll('file').filter((f) => typeof f === 'object' && 'arrayBuffer' in f);
  if (files.length === 0) {
    return json({ error: 'geen bestanden in veld "file"' }, 400);
  }

  // mode=register -> alleen OCR + registreren (niet opnieuw naar Basecone sturen).
  const skipSend = form.get('mode') === 'register';

  const results = [];
  let anyFail = false;

  for (const file of files) {
    const filename = file.name || 'upload';
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const contentType = file.type || 'application/octet-stream';

      const reason = processableReason(contentType, buf.length, filename, UPLOAD_MIN_BYTES);
      if (reason) {
        anyFail = true;
        results.push({ filename, status: 'skipped', reason, vendor: null, amount: null, doc_date: null });
        continue;
      }

      // Handmatige upload heeft geen message_id -> altijd registreren.
      const r = await processAttachment({
        base64: buf.toString('base64'),
        contentType,
        filename,
        note: null,
        messageId: null,
        fromAddress: null,
        source: 'foto',
        skipSend,
      });
      results.push(r);
    } catch (err) {
      anyFail = true;
      results.push({ filename, status: 'error', error: String(err.message || err), vendor: null, amount: null, doc_date: null });
    }
  }

  // Na het verwerken meteen proberen te koppelen aan bestaande banktransacties.
  if (results.some((r) => r.status === 'sent' || r.status === 'registered')) {
    try {
      await runMatching();
      await classifyByRules();
    } catch {
      // koppelen mag de upload niet laten falen
    }
  }

  // 207 bij gedeeltelijk falen, anders 200.
  const okStatuses = ['sent', 'registered'];
  const status = anyFail && results.some((r) => okStatuses.includes(r.status)) ? 207 : anyFail ? 502 : 200;
  return json({ status: status === 200 ? 'ok' : 'partial', results }, status);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
