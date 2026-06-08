-- Documents: één rij per verwerkte bon/factuur (per bijlage).
create table if not exists documents (
  id              bigint generated always as identity primary key,
  sent_at         timestamptz,                       -- moment van versturen naar Basecone
  doc_date        date,                              -- factuurdatum (uit OCR), null indien onbekend
  amount          numeric(12,2),                     -- totaalbedrag (incl. btw)
  vat             numeric(12,2),                     -- btw-bedrag
  currency        text default 'EUR',
  vendor          text,                              -- leverancier/winkel
  source          text not null,                     -- 'foto' | 'email-factuur'
  subject         text,                              -- onderwerp van de bron-mail (indien van toepassing)
  from_address    text,                              -- afzender van de bron-mail
  to_address      text,                              -- Basecone-adres waarheen verstuurd
  message_id      text unique,                       -- idempotentiesleutel; null bij handmatige upload
  basecone_status text,                              -- 'sent' | 'error'
  attachment_name text,
  attachment_url  text,
  ocr_raw         jsonb,                             -- ruwe OCR-respons voor debugging
  matched_tx_id   text,                              -- optioneel: koppeling aan banktransactie
  created_at      timestamptz not null default now()
);

create index if not exists documents_doc_date_idx on documents (doc_date);
create index if not exists documents_amount_idx   on documents (amount);

-- Transactions: regels uit een bankafschrift (CSV-import), voor volledigheidscontrole.
create table if not exists transactions (
  id             bigint generated always as identity primary key,
  tx_date        date not null,                     -- transactiedatum
  amount         numeric(12,2) not null,            -- negatief = uitgave (Af), positief = bij
  currency       text default 'EUR',
  counterparty   text,                              -- naam tegenpartij
  description     text,                             -- omschrijving/mededeling
  source_file    text,                              -- bestandsnaam van het afschrift
  fingerprint    text unique,                       -- idempotentie bij her-upload
  matched_doc_id bigint references documents (id),  -- gekoppelde bon/factuur
  created_at     timestamptz not null default now()
);

create index if not exists transactions_tx_date_idx on transactions (tx_date);
create index if not exists transactions_amount_idx  on transactions (amount);
