// Flexibele bankafschrift-CSV-parser. Herkent automatisch het scheidingsteken,
// de relevante kolommen (datum/bedrag/tegenpartij/omschrijving) en de NL-bedragnotatie.
// Werkt voor de gangbare exports van o.a. ING, Rabobank en ABN AMRO.

export function parseBankCsv(text) {
  const warnings = [];

  // 1) Scheidingsteken bepalen op basis van de kopregel (buiten quotes tellen).
  const firstLine = (text.split(/\r?\n/).find((l) => l.trim() !== '')) || '';
  const delim = [',', ';', '\t']
    .map((d) => ({ d, n: countDelim(firstLine, d) }))
    .sort((a, b) => b.n - a.n)[0].d;

  // 2) Tokenizen (quote-aware).
  const rows = parseCsvRows(text, delim).filter((r) => r.length && r.some((c) => c.trim() !== ''));
  if (rows.length < 2) throw new Error('CSV bevat geen databregels.');

  const header = rows[0].map((h) => h.trim());
  const idx = mapColumns(header);
  if (idx.date < 0 || idx.amount < 0) {
    throw new Error(`Kon datum/bedrag-kolom niet herkennen. Gevonden kolommen: ${header.join(', ')}`);
  }

  // 3) Databregels omzetten naar transacties.
  const seen = new Map(); // voor occurrence-index in de fingerprint
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tx_date = normalizeDate(get(row, idx.date));
    let amount = parseDutchNumber(get(row, idx.amount));

    if (!tx_date || Number.isNaN(amount)) {
      warnings.push(`Regel ${i + 1} overgeslagen (datum/bedrag onleesbaar).`);
      continue;
    }

    // Af/Bij-indicator toepassen indien aanwezig (anders vertrouwen we op het teken).
    if (idx.afbij >= 0) {
      const v = (get(row, idx.afbij) || '').trim().toLowerCase();
      if (/^(af|debet|debit|d)$/.test(v)) amount = -Math.abs(amount);
      else if (/^(bij|credit|c)$/.test(v)) amount = Math.abs(amount);
    }

    const counterparty = idx.name >= 0 ? clean(get(row, idx.name)) : null;
    const description = idx.desc >= 0 ? clean(get(row, idx.desc)) : null;

    const rounded = Math.round(amount * 100) / 100;
    const baseKey = `${tx_date}|${rounded.toFixed(2)}|${(counterparty || '').toLowerCase()}|${(description || '').toLowerCase()}`;
    const occ = (seen.get(baseKey) || 0) + 1;
    seen.set(baseKey, occ);

    out.push({
      tx_date,
      amount: rounded,
      counterparty,
      description,
      fingerprint: `${baseKey}#${occ}`,
    });
  }

  return { rows: out, warnings, columns: header };
}

// --- Helpers --------------------------------------------------------------

function get(row, i) {
  return i >= 0 && i < row.length ? row[i] : '';
}

function clean(s) {
  const t = String(s || '').trim();
  return t === '' ? null : t;
}

// Tel een scheidingsteken in een regel, quotes negerend.
function countDelim(line, d) {
  let n = 0;
  let q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === d && !q) n++;
  }
  return n;
}

// Quote-aware CSV-tokenizer: levert een array van rijen (arrays van velden).
function parseCsvRows(s, delim) {
  const rows = [];
  let field = '';
  let row = [];
  let inQ = false;
  let i = 0;

  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; } // ge-escapete quote
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Kolomindexen vinden op basis van veelvoorkomende koptekst-woorden.
function mapColumns(header) {
  const find = (re) => header.findIndex((h) => re.test(h));
  return {
    date: find(/datum|date|boekdat|transactiedat/i),
    amount: find(/bedrag|amount/i),
    afbij: find(/af.?bij|bij.?af|debet|credit|debit/i),
    name: find(/naam|tegenpartij|tegenrekening|begunstigde|counterpart|^name/i),
    desc: find(/omschrijving|mededeling|description|betalingskenmerk/i),
  };
}

// NL-bedrag naar number: "1.234,56" -> 1234.56, "-12,5" -> -12.5, "12.50" -> 12.5.
function parseDutchNumber(s) {
  if (s == null) return NaN;
  let t = String(s).trim().replace(/[€\s]/g, '');
  if (!t) return NaN;

  let neg = false;
  if (/^-/.test(t)) { neg = true; t = t.slice(1); }
  if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }

  const hasDot = t.includes('.');
  const hasComma = t.includes(',');
  if (hasDot && hasComma) t = t.replace(/\./g, '').replace(',', '.'); // punt = duizendtal
  else if (hasComma) t = t.replace(',', '.'); // komma = decimaal

  const n = Number(t);
  if (Number.isNaN(n)) return NaN;
  return neg ? -n : n;
}

// Diverse datumnotaties naar YYYY-MM-DD.
function normalizeDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{4})\/(\d{2})\/(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/))) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
