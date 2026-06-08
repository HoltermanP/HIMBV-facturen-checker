// Mailbox-poll via Vercel Cron. Haalt ongelezen facturen uit INTAKE_FOLDER (IMAP),
// verwerkt elke bijlage en markeert het bericht daarna als gelezen.
import { fetchUnreadWithAttachments, markReadUids } from '../../../lib/mail.js';
import { processAttachment, isProcessable } from '../../../lib/process.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  // Auth: Bearer CRON_SECRET OF de door Vercel Cron gezette header x-vercel-cron.
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const isCron = req.headers.get('x-vercel-cron') != null;
  if (!isCron && (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const folder = process.env.INTAKE_FOLDER;
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  const detail = [];
  const readyUids = []; // berichten zonder harde fout -> als gelezen markeren

  let messages;
  try {
    messages = await fetchUnreadWithAttachments(folder);
  } catch (err) {
    // Map niet gevonden of IMAP onbereikbaar -> harde fout.
    return json({ error: String(err.message || err) }, 502);
  }

  for (const msg of messages) {
    let msgHadError = false;

    for (const att of msg.attachments) {
      const filename = att.name;
      // Idempotentiesleutel per bijlage: stabiel over cron-runs heen.
      const messageId = `${msg.internetMessageId || msg.uid}#${att.id}`;

      if (!isProcessable(att.contentType, att.size)) {
        skipped++;
        detail.push({ filename, messageId, status: 'skipped', reason: 'type/grootte' });
        continue;
      }

      try {
        const r = await processAttachment({
          base64: att.base64,
          contentType: att.contentType,
          filename,
          note: msg.subject || null,
          messageId,
          fromAddress: msg.from,
          source: 'email-factuur',
        });
        if (r.status === 'sent') processed++;
        else skipped++;
        detail.push({ filename, messageId, ...r });
      } catch (err) {
        // sendMail-fout: bijlage telt als error en bericht NIET als gelezen markeren,
        // zodat de volgende cron-run het opnieuw probeert.
        errors++;
        msgHadError = true;
        detail.push({ filename, messageId, status: 'error', error: String(err.message || err) });
      }
    }

    // Alleen markeren als gelezen wanneer er geen harde fout was.
    if (!msgHadError) readyUids.push(msg.uid);
  }

  // Eén IMAP-sessie om alle verwerkte berichten als gelezen te markeren.
  try {
    await markReadUids(folder, readyUids);
  } catch (err) {
    detail.push({ status: 'warn', error: `markRead faalde: ${String(err.message || err)}` });
  }

  return json({ processed, skipped, errors, detail }, 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
