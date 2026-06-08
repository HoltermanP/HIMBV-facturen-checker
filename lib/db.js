// Neon Postgres (serverless driver). Eén verbinding per invocation volstaat.
import { neon } from '@neondatabase/serverless';

// Lazy init: pas een verbinding maken bij eerste query, niet bij module-load.
// Zo crasht `next build` niet wanneer DATABASE_URL nog niet gezet is.
// fetchOptions cache:'no-store' is cruciaal: anders cachet Next.js de HTTP-calls
// van de Neon-driver, waardoor statische queries een verouderd resultaat blijven geven.
let _sql;
function sql(strings, ...values) {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL, { fetchOptions: { cache: 'no-store' } });
  }
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

// Ongematchte posten (beide richtingen) — kandidaten die een document zouden moeten hebben.
export async function unmatchedTransactions() {
  return await sql`
    select id, tx_date, amount, counterparty, description
    from transactions
    where matched_doc_id is null and amount <> 0
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

// Openstaande posten (beide richtingen): document nodig (open) of voorgesteld geen
// document (suggested_none). 'none_needed' en gematchte vallen weg.
// Uitgaven (amount<0) horen bij een inkoopbon, bijschrijvingen (amount>0) bij een
// uitgaande factuur.
export async function openItems() {
  return await sql`
    select id, tx_date, amount, counterparty, description, receipt_status
    from transactions
    where matched_doc_id is null and amount <> 0 and receipt_status <> 'none_needed'
    order by tx_date desc, id desc
  `;
}

// Posten die bewust als 'geen document nodig' zijn gemarkeerd (om te kunnen terugdraaien).
export async function noneNeededItems() {
  return await sql`
    select id, tx_date, amount, counterparty, description
    from transactions
    where amount <> 0 and receipt_status = 'none_needed'
    order by tx_date desc, id desc
  `;
}

// Alle boekingen met statusindicatie (voor het totaaloverzicht).
export async function allTransactions() {
  return await sql`
    select id, tx_date, amount, counterparty, description, receipt_status, matched_doc_id
    from transactions
    order by tx_date desc, id desc
  `;
}

// Tellingen voor de statistiekblokken (gesplitst naar in-/uitgaand).
export async function itemStatusCounts() {
  const rows = await sql`
    select
      count(*) filter (where receipt_status='open' and matched_doc_id is null and amount<0)::int as open_out,
      count(*) filter (where receipt_status='open' and matched_doc_id is null and amount>0)::int as open_in,
      count(*) filter (where receipt_status='suggested_none' and matched_doc_id is null and amount<>0)::int as suggested,
      count(*) filter (where receipt_status='none_needed' and amount<>0)::int as none_needed,
      count(*) filter (where matched_doc_id is not null)::int as matched,
      coalesce(sum(abs(amount)) filter (where receipt_status='open' and matched_doc_id is null and amount<0), 0) as out_total,
      coalesce(sum(abs(amount)) filter (where receipt_status='open' and matched_doc_id is null and amount>0), 0) as in_total
    from transactions`;
  return rows[0];
}

// Zet de bon-status van één transactie.
export async function setReceiptStatus(id, status) {
  await sql`update transactions set receipt_status = ${status} where id = ${id}`;
}

// Markeer gelijksoortige OPEN posten (zelfde tegenpartij) als voorgesteld 'geen document'.
export async function suggestSimilarOpen(id) {
  await sql`
    update transactions t
    set receipt_status = 'suggested_none'
    where t.receipt_status = 'open' and t.matched_doc_id is null and t.amount <> 0
      and t.id <> ${id} and t.counterparty is not null
      and lower(trim(t.counterparty)) = (select lower(trim(counterparty)) from transactions where id = ${id})
  `;
}

// Pas alle bestaande 'geen document nodig'-regels toe op nog open posten (na import).
export async function classifyByRules() {
  await sql`
    update transactions t
    set receipt_status = 'suggested_none'
    where t.receipt_status = 'open' and t.matched_doc_id is null and t.amount <> 0
      and t.counterparty is not null
      and exists (
        select 1 from transactions r
        where r.receipt_status = 'none_needed' and r.counterparty is not null
          and lower(trim(r.counterparty)) = lower(trim(t.counterparty))
      )
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

// BTW per maand op basis van de boekingen (transacties).
// Per boeking: echte BTW van de gekoppelde bon indien aanwezig; 'geen document nodig'
// telt als 0 (geen BTW); anders een 21%-schatting (21/121 van het bedrag).
// Uitgaven = terug te vorderen (inkoop), bijschrijvingen = af te dragen (verkoop).
export async function vatByMonth() {
  const rows = await sql`
    select to_char(t.tx_date, 'YYYY-MM') as month, t.amount, t.receipt_status,
           t.matched_doc_id, d.vat as doc_vat
    from transactions t
    left join documents d on d.id = t.matched_doc_id
    where t.amount <> 0`;

  const map = new Map();
  for (const r of rows) {
    const amt = Number(r.amount);
    let vat = 0;
    let estimated = false;

    if (r.matched_doc_id && r.doc_vat != null) {
      vat = Math.abs(Number(r.doc_vat)); // echte BTW uit de bon
    } else if (r.receipt_status === 'none_needed') {
      vat = 0; // bewust geen document -> geen BTW
    } else {
      vat = (Math.abs(amt) * 21) / 121; // schatting 21%
      estimated = true;
    }

    const m = map.get(r.month) || { month: r.month, output: 0, input: 0, estimated: 0 };
    if (amt > 0) m.output += vat; // verkoop -> af te dragen
    else m.input += vat; // inkoop -> terug te vorderen
    if (estimated) m.estimated += vat;
    map.set(r.month, m);
  }

  const r2 = (n) => Math.round(n * 100) / 100;
  return [...map.values()]
    .map((m) => ({
      month: m.month,
      output: r2(m.output),
      input: r2(m.input),
      reserve: r2(m.output - m.input),
      estimated: r2(m.estimated),
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));
}

