// Gedeelde verwerkingspijplijn voor alle drie de ingangen (foto, upload, mail).
import { extractFields } from './ocr.js';
import { sendToBasecone } from './mail.js';
import { logDocument, seenMessage } from './db.js';

const MIN_BYTES = 15 * 1024; // 15 KB: filtert logo's/handtekeningen in mail-bijlagen

const EXT_TO_TYPE = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  heic: 'image/heic', heif: 'image/heif', webp: 'image/webp',
  gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff',
};

// Leid een bruikbaar MIME-type af; val terug op de bestandsextensie als de
// browser/mailclient geen (of een generiek) type meegeeft.
export function normalizeContentType(contentType, filename = '') {
  if (contentType && (contentType.startsWith('image/') || contentType === 'application/pdf')) {
    return contentType;
  }
  const ext = (String(filename).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  return EXT_TO_TYPE[ext] || contentType || 'application/octet-stream';
}

// Reden waarom een bestand niet verwerkbaar is ('' = wél verwerkbaar).
export function processableReason(contentType, bytes, filename = '') {
  const ct = normalizeContentType(contentType, filename);
  if (!(ct.startsWith('image/') || ct === 'application/pdf')) {
    return 'type niet ondersteund (alleen afbeelding of PDF)';
  }
  if (bytes <= MIN_BYTES) return 'bestand te klein (< 15 KB)';
  return '';
}

// Alleen afbeeldingen en PDF's, en groot genoeg om een echte bon/factuur te zijn.
export function isProcessable(contentType, bytes, filename = '') {
  return processableReason(contentType, bytes, filename) === '';
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
  skipSend = false, // true = alleen OCR + registreren (al naar Basecone gestuurd)
}) {
  // Idempotentie: bij mail al verwerkte bijlagen nooit opnieuw versturen.
  if (messageId && (await seenMessage(messageId))) {
    return { status: 'skipped', reason: 'already-seen', filename };
  }

  const to = process.env.BASECONE_ADDRESS;
  // Normaliseer het type (val terug op extensie) voor OCR én de bijlage naar Basecone.
  const ct = normalizeContentType(contentType, filename);
  const dataUrl = `data:${ct};base64,${base64}`;

  // OCR (faalt zacht naar nulls). filename helpt bij PDF-input.
  const fields = await extractFields(dataUrl, note || filename, filename);

  // Onderwerp helpt herkenning in Verzonden-items / Basecone.
  const subjectParts = [fields.vendor, fields.amount != null ? `€${fields.amount}` : null].filter(Boolean);
  const subject = subjectParts.length ? subjectParts.join(' ') : filename;

  // Versturen naar Basecone is een harde stap: gooit door bij falen.
  // Bij skipSend (her-registreren) slaan we het versturen over.
  if (!skipSend) {
    await sendToBasecone({
      to,
      subject,
      text: `Automatisch doorgestuurd${note ? ` (${note})` : ''}.`,
      filename,
      contentType: ct,
      base64,
    });
  }

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
    to_address: skipSend ? null : to,
    message_id: messageId || null,
    basecone_status: skipSend ? 'reeds-verstuurd' : 'sent',
    attachment_name: filename,
    attachment_url: null,
    ocr_raw: fields,
  });

  return {
    status: skipSend ? 'registered' : 'sent',
    filename,
    vendor: fields.vendor,
    amount: fields.amount,
    doc_date: fields.doc_date,
  };
}
