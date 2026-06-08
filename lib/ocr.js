// OCR via OpenAI gpt-4o-mini (vision). Faalt zacht: bij elke fout geven we
// nulls terug zodat het versturen naar Basecone nooit geblokkeerd wordt.

const EMPTY = { amount: null, vat: null, vendor: null, doc_date: null };

const SYSTEM = [
  'Je bent een nauwkeurige OCR-assistent voor Nederlandse bonnen en facturen.',
  'Geef UITSLUITEND een JSON-object terug met exact deze velden:',
  '{ "amount": number|null, "vat": number|null, "vendor": string|null, "doc_date": string|null }',
  '- amount: totaalbedrag inclusief btw, als getal (punt als decimaalteken).',
  '- vat: het btw-bedrag, als getal, of null.',
  '- vendor: naam van de leverancier/winkel, of null.',
  '- doc_date: factuur-/bondatum als "YYYY-MM-DD", of null als niet leesbaar.',
  'Verzin niets; gebruik null bij twijfel.',
].join('\n');

// dataUrl = "data:<contentType>;base64,<...>"; hint = optionele context (bestandsnaam/onderwerp).
export async function extractFields(dataUrl, hint) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ...EMPTY };

  try {
    const userContent = [
      {
        type: 'text',
        text: hint
          ? `Context: ${hint}. Lees onderstaande afbeelding en geef de gevraagde JSON.`
          : 'Lees onderstaande afbeelding en geef de gevraagde JSON.',
      },
      { type: 'image_url', image_url: { url: dataUrl } },
    ];

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!res.ok) return { ...EMPTY };

    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) return { ...EMPTY };

    const parsed = JSON.parse(raw);
    return {
      amount: toNumber(parsed.amount),
      vat: toNumber(parsed.vat),
      vendor: typeof parsed.vendor === 'string' && parsed.vendor.trim() ? parsed.vendor.trim() : null,
      doc_date: isIsoDate(parsed.doc_date) ? parsed.doc_date : null,
    };
  } catch {
    // Soft fail: nooit de pipeline laten crashen op OCR.
    return { ...EMPTY };
  }
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isIsoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
