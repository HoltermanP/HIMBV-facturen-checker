// Neon Postgres (serverless driver). Eén verbinding per invocation volstaat.
import { neon } from '@neondatabase/serverless';

// Lazy init: pas een verbinding maken bij eerste query, niet bij module-load.
// Zo crasht `next build` niet wanneer DATABASE_URL nog niet gezet is.
let _sql;
function sql(strings, ...values) {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql(strings, ...values);
}

// Insert een document, idempotent op message_id.
// Bij handmatige upload is message_id null -> Postgres staat meerdere nulls toe,
// dus die worden altijd geregistreerd. Bij mail voorkomt de unieke key dubbels.
export async function logDocument(d) {
  const rows = await sql`
    insert into documents (
      sent_at, doc_date, amount, vat, currency, vendor, source,
      subject, from_address, to_address, message_id, basecone_status,
      attachment_name, attachment_url, ocr_raw
    ) values (
      now(), ${d.doc_date}, ${d.amount}, ${d.vat}, ${d.currency || 'EUR'},
      ${d.vendor}, ${d.source}, ${d.subject}, ${d.from_address}, ${d.to_address},
      ${d.message_id}, ${d.basecone_status}, ${d.attachment_name},
      ${d.attachment_url}, ${d.ocr_raw ? JSON.stringify(d.ocr_raw) : null}
    )
    on conflict (message_id) do nothing
    returning id
  `;
  return rows[0] || null; // null = bestond al (conflict) -> niets gedaan
}

// Is een bijlage (op message_id-sleutel) al eerder verwerkt?
export async function seenMessage(messageId) {
  if (!messageId) return false;
  const rows = await sql`select 1 from documents where message_id = ${messageId} limit 1`;
  return rows.length > 0;
}

// Recente documenten voor een eventueel overzicht.
export async function recentDocuments(limit = 20) {
  return await sql`
    select id, sent_at, doc_date, amount, vendor, source, basecone_status, attachment_name
    from documents
    order by created_at desc
    limit ${limit}
  `;
}

// --- Bankafschriften / volledigheidscontrole ------------------------------

// Insert een transactie, idempotent op fingerprint (her-upload geeft geen dubbels).
export async function insertTransaction(t) {
  const rows = await sql`
    insert into transactions (tx_date, amount, currency, counterparty, description, source_file, fingerprint)
    values (${t.tx_date}, ${t.amount}, ${t.currency || 'EUR'}, ${t.counterparty},
            ${t.description}, ${t.source_file}, ${t.fingerprint})
    on conflict (fingerprint) do nothing
    returning id
  `;
  return rows[0] || null; // null = bestond al
}

// Ongematchte uitgaven (Af) — kandidaten die een bon zouden moeten hebben.
export async function unmatchedExpenseTransactions() {
  return await sql`
    select id, tx_date, amount, counterparty, description
    from transactions
    where matched_doc_id is null and amount < 0
    order by tx_date asc
  `;
}

// Ongematchte bonnen/facturen met een bedrag — kandidaten om aan te koppelen.
export async function unmatchedDocumentsWithAmount() {
  return await sql`
    select id, doc_date, amount, vendor
    from documents
    where matched_tx_id is null and amount is not null
  `;
}

// Koppel een transactie en een document aan elkaar (beide kanten).
export async function linkMatch(txId, docId) {
  await sql`update transactions set matched_doc_id = ${docId} where id = ${txId}`;
  await sql`update documents set matched_tx_id = ${String(txId)} where id = ${docId}`;
}

// Rapport: uitgaven zonder gekoppelde bon (de "gaten").
export async function missingReceipts() {
  return await sql`
    select id, tx_date, amount, counterparty, description
    from transactions
    where matched_doc_id is null and amount < 0
    order by tx_date desc
  `;
}

// Rapport: geregistreerde bonnen zonder bijbehorende banktransactie.
export async function documentsWithoutTransaction() {
  return await sql`
    select id, doc_date, amount, vendor, attachment_name, source
    from documents
    where matched_tx_id is null
    order by created_at desc
  `;
}

// Diagnose: ruwe tellingen om databasestaat van de live app te inspecteren.
export async function debugCounts() {
  const tx = await sql`
    select count(*)::int total,
           count(*) filter (where amount < 0)::int neg,
           count(*) filter (where amount > 0)::int pos,
           count(*) filter (where matched_doc_id is not null)::int matched,
           count(*) filter (where matched_doc_id is null and amount < 0)::int missing,
           coalesce(min(amount), 0) min_amt,
           coalesce(max(amount), 0) max_amt
    from transactions`;
  const doc = await sql`
    select count(*)::int total,
           count(*) filter (where amount is not null)::int with_amount,
           count(*) filter (where matched_tx_id is not null)::int matched
    from documents`;
  const negSample = await sql`
    select id, tx_date, amount, counterparty, matched_doc_id
    from transactions where amount < 0 order by tx_date desc limit 20`;
  const anySample = await sql`
    select id, tx_date, amount, counterparty
    from transactions order by tx_date desc limit 20`;
  return { transactions: tx[0], documents: doc[0], negSample, anySample };
}
