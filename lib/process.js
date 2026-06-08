// Gedeelde verwerkingspijplijn voor alle drie de ingangen (foto, upload, mail).
import { extractFields } from './ocr.js';
import { sendToBasecone } from './mail.js';
import { logDocument, seenMessage } from './db.js';

const MIN_BYTES = 15 * 1024; // 15 KB: filtert logo's/handtekeningen in mail-bijlagen

// Alleen afbeeldingen en PDF's, en groot genoeg om een echte bon/factuur te zijn.
export function isProcessable(contentType, bytes) {
  if (!contentType) return false;
  const ok = contentType.startsWith('image/') || contentType === 'application/pdf';
  return ok && bytes > MIN_BYTES;
}

// Verwerk één bijlage: (skip indien gezien) -> OCR -> sendMail -> registreer.
// Een mislukte OCR is zacht (lege velden); een mislukte sendMail gooit door (502).
export async function processAttachment({
  base64,
  contentType,
  filename,
  note,
  messageId, // idempotentiesleutel; null bij handmatige upload
  fromAddress,
  source, // 'foto' | 'email-factuur'
}) {
  // Idempotentie: bij mail al verwerkte bijlagen nooit opnieuw versturen.
  if (messageId && (await seenMessage(messageId))) {
    return { status: 'skipped', reason: 'already-seen', filename };
  }

  const to = process.env.BASECONE_ADDRESS;
  const dataUrl = `data:${contentType};base64,${base64}`;

  // OCR (faalt zacht naar nulls).
  const fields = await extractFields(dataUrl, note || filename);

  // Onderwerp helpt herkenning in Verzonden-items / Basecone.
  const subjectParts = [fields.vendor, fields.amount != null ? `€${fields.amount}` : null].filter(Boolean);
  const subject = subjectParts.length ? subjectParts.join(' ') : filename;

  // Versturen naar Basecone is een harde stap: gooit door bij falen.
  await sendToBasecone({
    to,
    subject,
    text: `Automatisch doorgestuurd${note ? ` (${note})` : ''}.`,
    filename,
    contentType,
    base64,
  });

  // Registreren in Neon (idempotent op message_id).
  await logDocument({
    doc_date: fields.doc_date,
    amount: fields.amount,
    vat: fields.vat,
    currency: 'EUR',
    vendor: fields.vendor,
    source,
    subject: note || null,
    from_address: fromAddress || null,
    to_address: to,
    message_id: messageId || null,
    basecone_status: 'sent',
    attachment_name: filename,
    attachment_url: null,
    ocr_raw: fields,
  });

  return {
    status: 'sent',
    filename,
    vendor: fields.vendor,
    amount: fields.amount,
    doc_date: fields.doc_date,
  };
}
