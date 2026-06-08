'use client';

import { useEffect, useState } from 'react';

// Volledigheidscontrole: bankafschrift (CSV) uploaden, matchen en de gaten tonen.
export default function Check() {
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [importInfo, setImportInfo] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setSecret(localStorage.getItem('INTAKE_SECRET') || '');
  }, []);

  async function uploadCsv(file) {
    if (!file) return;
    if (!secret) {
      setError('Vul eerst je INTAKE_SECRET in op de hoofdpagina (Instellingen).');
      return;
    }
    setBusy(true);
    setError(null);
    setImportInfo(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/transactions/import', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Import faalde (${res.status})`);
      } else {
        setImportInfo(data);
        await loadReport();
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function loadReport() {
    if (!secret) return;
    setError(null);
    try {
      const res = await fetch('/api/report', { headers: { authorization: `Bearer ${secret}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || `Rapport faalde (${res.status})`);
      else setReport(data);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  useEffect(() => {
    if (secret) loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret]);

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 60px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Volledigheidscontrole</h1>
        <a href="/" style={{ color: '#2563eb', textDecoration: 'none' }}>
          ← Bonnen uploaden
        </a>
      </header>
      <p style={{ color: '#5b6470', marginTop: 6 }}>
        Upload een bankafschrift (CSV). We koppelen elke uitgave aan een geregistreerde bon en
        tonen wat nog ontbreekt.
      </p>

      <section style={card}>
        <label style={btnPrimary}>
          {busy ? 'Bezig…' : '📄 Bankafschrift (CSV/TAB) kiezen'}
          <input
            type="file"
            accept=".csv,.tab,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            disabled={busy}
            style={{ display: 'none' }}
            onChange={(e) => {
              uploadCsv(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button onClick={loadReport} disabled={busy} style={btnGhost}>
          Ververs overzicht
        </button>
      </section>

      {error && <div style={errBox}>{error}</div>}

      {importInfo && (
        <div style={infoBox}>
          {importInfo.parsed} regels gelezen · {importInfo.imported} nieuw ·{' '}
          {importInfo.duplicates} dubbel · {importInfo.matched} gekoppeld
          {importInfo.warnings?.length ? ` · ${importInfo.warnings.length} overgeslagen` : ''}
        </div>
      )}

      {report && (
        <>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <Stat label="Uitgaven zonder bon" value={report.counts.missing} tone="warn" />
            <Stat label="Bedrag ontbrekend" value={`€ ${report.counts.missingTotal}`} tone="warn" />
            <Stat label="Bonnen zonder transactie" value={report.counts.docsWithout} tone="neutral" />
          </div>

          <h2 style={h2}>Uitgaven zonder bon</h2>
          {report.missing.length === 0 ? (
            <p style={ok}>✓ Elke uitgave heeft een bon.</p>
          ) : (
            <Table
              head={['Datum', 'Bedrag', 'Tegenpartij', 'Omschrijving']}
              rows={report.missing.map((t) => [
                t.tx_date,
                `€ ${Math.abs(Number(t.amount)).toFixed(2)}`,
                t.counterparty || '—',
                t.description || '—',
              ])}
            />
          )}

          <h2 style={h2}>Bonnen zonder transactie</h2>
          {report.docsWithout.length === 0 ? (
            <p style={ok}>✓ Elke bon is gekoppeld.</p>
          ) : (
            <Table
              head={['Datum', 'Bedrag', 'Leverancier', 'Bestand']}
              rows={report.docsWithout.map((d) => [
                d.doc_date || '—',
                d.amount != null ? `€ ${Number(d.amount).toFixed(2)}` : '—',
                d.vendor || '—',
                d.attachment_name || '—',
              ])}
            />
          )}
        </>
      )}
    </main>
  );
}

function Stat({ label, value, tone }) {
  const bg = tone === 'warn' ? '#fef3c7' : '#eef2ff';
  const fg = tone === 'warn' ? '#92400e' : '#3730a3';
  return (
    <div style={{ background: bg, color: fg, borderRadius: 12, padding: '12px 16px', flex: '1 1 160px' }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}

function Table({ head, rows }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e5e7eb', color: '#5b6470' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9', whiteSpace: j === 3 ? 'normal' : 'nowrap' }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' };
const btnPrimary = { padding: '10px 16px', borderRadius: 10, fontSize: 15, cursor: 'pointer', background: '#2563eb', color: '#fff', display: 'inline-block' };
const btnGhost = { padding: '10px 14px', borderRadius: 10, fontSize: 15, cursor: 'pointer', background: 'transparent', color: '#2563eb', border: '1px solid #cbd5e1' };
const errBox = { background: '#fee2e2', color: '#991b1b', borderRadius: 10, padding: '10px 12px', marginTop: 14, fontSize: 14 };
const infoBox = { background: '#dcfce7', color: '#166534', borderRadius: 10, padding: '10px 12px', marginTop: 14, fontSize: 14 };
const h2 = { fontSize: 17, marginTop: 26, marginBottom: 8 };
const ok = { color: '#166534', background: '#f0fdf4', padding: '10px 12px', borderRadius: 10 };
