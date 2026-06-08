// Matching tussen banktransacties (uitgaven) en geregistreerde bonnen/facturen.
// Regel: zelfde bedrag (op de cent) én datum binnen ±WINDOW_DAYS. Leveranciersnaam
// die op de tegenpartij lijkt telt als tiebreaker. Eén-op-één: een bon wordt
// hooguit aan één transactie gekoppeld.
import {
  unmatchedExpenseTransactions,
  unmatchedDocumentsWithAmount,
  linkMatch,
} from './db.js';

const WINDOW_DAYS = 7;

export async function runMatching() {
  const txs = await unmatchedExpenseTransactions();
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

      // Lagere score = betere match: dichtste datum, met korting bij naam-overeenkomst.
      const score = dd - (vendorSimilar(doc.vendor, tx.counterparty) ? 0.5 : 0);
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
