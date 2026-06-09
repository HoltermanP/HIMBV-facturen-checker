// Matching tussen banktransacties (uitgaven) en geregistreerde bonnen/facturen.
// Regel: zelfde bedrag (op de cent) én datum binnen ±WINDOW_DAYS. Leveranciersnaam
// die op de tegenpartij lijkt telt als tiebreaker. Eén-op-één: een bon wordt
// hooguit aan één transactie gekoppeld.
import {
  unmatchedTransactions,
  unmatchedDocumentsWithAmount,
  linkMatch,
} from './db.js';

const WINDOW_DAYS = 60; // facturen worden vaak weken na de factuurdatum betaald
const NEAR_DAYS = 10; // binnen ~10 dagen volstaat het bedrag; verder weg ook naam vereist

export async function runMatching() {
  const txs = await unmatchedTransactions();
  const docs = await unmatchedDocumentsWithAmount();
  const usedDocs = new Set();
  let matched = 0;

  for (const tx of txs) {
    const target = Math.abs(Number(tx.amount));
    let best = null;
    let bestScore = Infinity;

    for (const doc of docs) {
      if (usedDocs.has(doc.id)) continue;
      if (Number(doc.amount) !== target) continue; // bedrag moet exact kloppen

      const dd = daysBetween(tx.tx_date, doc.doc_date);
      if (dd === null || dd > WINDOW_DAYS) continue;

      // Ver uit elkaar (betaaltermijn)? Dan naam- óf referentie-overeenkomst eisen.
      // Referentie = factuurnummer dat in zowel de bankomschrijving als de bon voorkomt.
      const sameName = vendorSimilar(doc.vendor, tx.counterparty);
      const ref = referenceMatch(doc, tx);
      if (dd > NEAR_DAYS && !sameName && !ref) continue;

      // Lagere score = betere match: dichtste datum, met korting bij naam/referentie.
      const score = dd - (sameName ? 0.5 : 0) - (ref ? 1 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = doc;
      }
    }

    if (best) {
      await linkMatch(tx.id, best.id);
      usedDocs.add(best.id);
      matched++;
    }
  }

  return matched;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.abs((d1.getTime() - d2.getTime()) / 86_400_000);
}

// Eenvoudige naam-gelijkenis: deelt een betekenisvol woord (>3 letters)?
function vendorSimilar(vendor, counterparty) {
  if (!vendor || !counterparty) return false;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const a = norm(vendor).split(/\s+/).filter((w) => w.length > 3);
  const b = norm(counterparty);
  return a.some((w) => b.includes(w));
}

// Referentie-match: komt een factuurnummer-achtige code (uit bestandsnaam/leverancier
// van de bon) terug in de omschrijving van de banktransactie? Sterk signaal bij
// verkoopfacturen, waar de naam op de bon afwijkt van de tegenpartij op de bank.
function referenceMatch(doc, tx) {
  const hay = onlyAlnum(tx.description || '');
  if (hay.length < 5) return false;
  const refs = extractRefs(`${doc.attachment_name || ''} ${doc.vendor || ''}`);
  return refs.some((r) => hay.includes(r));
}

function onlyAlnum(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Codes met minstens één cijfer en (genormaliseerd) lengte >= 5 — bv. "2026-0125".
function extractRefs(s) {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9._/-]{4,}/g) || [])
    .filter((t) => /\d/.test(t))
    .map(onlyAlnum)
    .filter((t) => t.length >= 5);
}
