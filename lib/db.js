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
