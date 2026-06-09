// Gedeelde verwerkingspijplijn voor alle drie de ingangen (foto, upload, mail).
import { extractFields } from './ocr.js';
import { sendToBasecone } from './mail.js';
import { logDocument, seenMessage } from './db.js';

// Mail: 15 KB-drempel filtert logo's/handtekeningen in mailfooters.
// Handmatige upload: lage drempel (gebruiker koos het bestand bewust); alleen lege
// of kapotte bestandjes weren.
export const MAIL_MIN_BYTES = 15 * 1024;
export const UPLOAD_MIN_BYTES = 1024;
const MIN_BYTES = MAIL_MIN_BYTES;

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
export function processableReason(contentType, bytes, filename = '', minBytes = MIN_BYTES) {
  const ct = normalizeContentType(contentType, filename);
  if (!(ct.startsWith('image/') || ct === 'application/pdf')) {
    return 'type niet ondersteund (alleen afbeelding of PDF)';
  }
  if (bytes <= minBytes) return `bestand te klein (< ${Math.round(minBytes / 1024)} KB)`;
  return '';
}

// Alleen afbeeldingen en PDF's, en groot genoeg om een echte bon/factuur te zijn.
export function isProcessable(contentType, bytes, filename = '', minBytes = MIN_BYTES) {
  return processableReason(contentType, bytes, filename, minBytes) === '';
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
