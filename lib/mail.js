// Mail via standaard SMTP (versturen) en IMAP (ophalen) — werkt op gewone hosting.
// Versturen gebeurt vanuit MAILBOX_USER (@himbv.nl), zodat Basecone de afzender accepteert.
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

// --- Verbindingen ---------------------------------------------------------

function smtpTransport() {
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = directe TLS, 587 = STARTTLS
    auth: { user: process.env.MAILBOX_USER, pass: process.env.MAILBOX_PASSWORD },
  });
}

function imapClient() {
  return new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.MAILBOX_USER, pass: process.env.MAILBOX_PASSWORD },
    logger: false,
  });
}

// --- Versturen ------------------------------------------------------------

// Stuur de bijlage naar Basecone vanuit de eigen mailbox.
// Probeert daarna een kopie in de Verzonden-map te zetten (faalt zacht).
export async function sendToBasecone({ to, subject, text, filename, contentType, base64 }) {
  const mail = {
    from: process.env.MAILBOX_USER,
    to,
    subject: subject || 'Bon/Factuur',
    text: text || '',
    attachments: [{ filename, content: Buffer.from(base64, 'base64'), contentType }],
  };

  const info = await smtpTransport().sendMail(mail);
  if (!info.accepted || info.accepted.length === 0) {
    throw new Error(`SMTP weigerde de mail: ${JSON.stringify(info.rejected || info.response)}`);
  }

  // Best-effort: zelfde mail in de Verzonden-map opslaan zodat je 'm terugziet.
  try {
    await appendToSent(mail);
  } catch {
    // niet kritisch; versturen is al gelukt
  }
  return true;
}

// Bouw de ruwe MIME-mail en plaats hem in de Verzonden-map via IMAP.
async function appendToSent(mail) {
  if (!process.env.IMAP_HOST) return;

  // Ruwe boodschap genereren zonder echt te versturen.
  const built = await nodemailer
    .createTransport({ streamTransport: true, buffer: true, newline: 'crlf' })
    .sendMail(mail);

  const client = imapClient();
  await client.connect();
  try {
    const sent = await findSentMailbox(client);
    if (sent) await client.append(sent, built.message, ['\\Seen']);
  } finally {
    await client.logout();
  }
}

async function findSentMailbox(client) {
  const list = await client.list();
  // Voorkeur voor de map met de \Sent special-use vlag, anders op naam.
  const special = list.find((b) => b.specialUse === '\\Sent');
  if (special) return special.path;
  const byName = list.find((b) => /^(sent|verzonden)/i.test(b.name));
  return byName ? byName.path : null;
}

// --- Lezen ----------------------------------------------------------------

// Zoek het pad van een map op naam (exact, of op het laatste pad-segment voor submappen).
async function findMailboxPath(client, name) {
  const list = await client.list();
  const exact = list.find((b) => b.path === name || b.name === name);
  if (exact) return exact.path;
  const sub = list.find((b) => b.path.split(b.delimiter || '/').pop() === name);
  return sub ? sub.path : null;
}

// Haal ongelezen berichten mét bijlagen uit de map en lever de bijlagen al gedecodeerd terug.
// Eén IMAP-sessie: eerst alle metadata verzamelen, daarna pas downloaden (imapflow-vereiste).
export async function fetchUnreadWithAttachments(folderName) {
  const client = imapClient();
  await client.connect();
  const out = [];
  try {
    const path = await findMailboxPath(client, folderName);
    if (!path) {
      throw new Error(`Map "${folderName}" niet gevonden in mailbox ${process.env.MAILBOX_USER}`);
    }

    const lock = await client.getMailboxLock(path);
    try {
      // 1) Metadata van alle ongelezen berichten ophalen.
      const metas = [];
      for await (const msg of client.fetch({ seen: false }, { uid: true, envelope: true, bodyStructure: true })) {
        const parts = collectAttachmentParts(msg.bodyStructure);
        if (parts.length === 0) continue; // alleen mail met bijlagen
        metas.push({ uid: msg.uid, envelope: msg.envelope, parts });
      }

      // 2) Per bericht de bijlagen downloaden.
      for (const m of metas) {
        const attachments = [];
        for (const p of m.parts) {
          const { content } = await client.download(String(m.uid), p.part, { uid: true });
          const buf = await streamToBuffer(content);
          attachments.push({
            id: p.part, // stabiel MIME-deelnummer -> goede idempotentiesleutel
            name: p.filename || `bijlage-${p.part}`,
            contentType: p.contentType,
            size: p.size || buf.length,
            base64: buf.toString('base64'),
          });
        }
        out.push({
          uid: m.uid,
          internetMessageId: m.envelope?.messageId || null,
          subject: m.envelope?.subject || null,
          from: m.envelope?.from?.[0]?.address || null,
          attachments,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return out;
}

// Markeer berichten (op UID) als gelezen zodat de volgende cron-run ze overslaat.
export async function markReadUids(folderName, uids) {
  if (!uids || uids.length === 0) return;
  const client = imapClient();
  await client.connect();
  try {
    const path = await findMailboxPath(client, folderName);
    if (!path) return;
    const lock = await client.getMailboxLock(path);
    try {
      await client.messageFlagsAdd(
        uids.map(String),
        ['\\Seen'],
        { uid: true },
      );
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

// --- Helpers --------------------------------------------------------------

// Loop de MIME-boom af en verzamel de echte bijlagen (geen multipart-containers).
function collectAttachmentParts(node, acc = []) {
  if (!node) return acc;
  if (node.childNodes && node.childNodes.length) {
    for (const child of node.childNodes) collectAttachmentParts(child, acc);
  } else {
    const filename = node.dispositionParameters?.filename || node.parameters?.name || null;
    const isAttachment = node.disposition === 'attachment' || !!filename;
    if (isAttachment) {
      acc.push({
        part: node.part || '1',
        contentType: node.type || 'application/octet-stream',
        size: node.size || 0,
        filename,
      });
    }
  }
  return acc;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
