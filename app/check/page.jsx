'use client';

import { useEffect, useState } from 'react';

// Volledigheidscontrole: bankafschrift uploaden, matchen, afvinken en overzicht.
export default function Check() {
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [importInfo, setImportInfo] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('open'); // 'open' | 'all'
  const [pendingId, setPendingId] = useState(null);

  useEffect(() => {
    setSecret(localStorage.getItem('INTAKE_SECRET') || '');
  }, []);

  useEffect(() => {
    if (secret) loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret]);

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
      if (!res.ok) setError(data.error || `Import faalde (${res.status})`);
      else {
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
      const res = await fetch('/api/report', {
        headers: { authorization: `Bearer ${secret}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || `Rapport faalde (${res.status})`);
      else setReport(data);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  // Status van een transactie aanpassen (afvinken / goedkeuren / terugzetten).
  async function resolve(id, status) {
    setPendingId(id);
    try {
      const res = await fetch('/api/transactions/resolve', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Bijwerken faalde (${res.status})`);
      } else {
        await loadReport();
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setPendingId(null);
    }
  }

  const c = report?.counts;

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Volledigheidscontrole</h1>
          <p className="subtitle">Bankafschrift uploaden, bonnen koppelen en de lijst leegwerken.</p>
        </div>
        <a href="/" className="btn btn-outline">← Bonnen uploaden</a>
      </div>

      {/* Upload */}
      <div className="card" style={{ marginTop: 18, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="btn btn-primary">
          {busy ? 'Bezig…' : '📄 Bankafschrift (CSV/TAB) kiezen'}
          <input
            type="file"
            accept=".csv,.tab,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            disabled={busy}
            style={{ display: 'none' }}
            onChange={(e) => { uploadCsv(e.target.files?.[0]); e.target.value = ''; }}
          />
        </label>
        <button className="btn btn-outline" onClick={loadReport} disabled={busy}>Ververs overzicht</button>
      </div>

      {error && <div className="errbox">{error}</div>}
      {importInfo && (
        <div className="note">
          {importInfo.parsed} regels gelezen · {importInfo.imported} nieuw · {importInfo.duplicates} dubbel ·{' '}
          {importInfo.matched} gekoppeld
          {importInfo.warnings?.length ? ` · ${importInfo.warnings.length} overgeslagen` : ''}
        </div>
      )}

      {/* Statistiek */}
      {c && (
        <div className="stats">
          <div className="stat amber">
            <div className="num">{c.open}</div>
            <div className="lbl">Bon ophalen{c.openTotal ? ` · € ${fmt(c.openTotal)}` : ''}</div>
          </div>
          <div className="stat blue">
            <div className="num">{c.suggested}</div>
            <div className="lbl">Ter goedkeuring (geen bon?)</div>
          </div>
          <div className="stat green">
            <div className="num">{c.matched}</div>
            <div className="lbl">Bon gekoppeld</div>
          </div>
          <div className="stat gray">
            <div className="num">{c.docsWithout}</div>
            <div className="lbl">Bonnen zonder transactie</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      {report && (
        <div className="tabs" style={{ marginBottom: 18 }}>
          <button className={`tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
            Openstaand{c ? ` (${c.open + c.suggested})` : ''}
          </button>
          <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
            Alle boekingen{report.all ? ` (${report.all.length})` : ''}
          </button>
        </div>
      )}

      {report && tab === 'open' && (
        <OpenTab report={report} resolve={resolve} pendingId={pendingId} />
      )}
      {report && tab === 'all' && <AllTab rows={report.all || []} />}
    </main>
  );
}

// --- Tab: openstaande uitgaven + terugdraai-sectie ------------------------

function OpenTab({ report, resolve, pendingId }) {
  const expenses = report.expenses || [];
  const noneNeeded = report.noneNeeded || [];
  const docsWithout = report.docsWithout || [];

  return (
    <>
      <h2 className="section-title">Uitgaven zonder bon</h2>
      {expenses.length === 0 ? (
        <div className="empty">✓ Alles afgehandeld — geen openstaande uitgaven.</div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <colgroup>
              <col style={{ width: 104 }} />
              <col style={{ width: 116 }} />
              <col style={{ width: '24%' }} />
              <col />
              <col style={{ width: 260 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Datum</th><th style={{ textAlign: 'right' }}>Bedrag</th>
                <th>Tegenpartij</th><th>Omschrijving</th><th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((t) => {
                const sug = t.receipt_status === 'suggested_none';
                const wait = pendingId === t.id;
                return (
                  <tr key={t.id} className={sug ? 'row-suggested' : ''}>
                    <td className="nowrap">{t.tx_date}</td>
                    <td className="num-cell amount-out">€ {fmt(Math.abs(Number(t.amount)))}</td>
                    <td className="wrap">{t.counterparty || <span className="muted">—</span>}</td>
                    <td className="wrap">{t.description || <span className="muted">—</span>}</td>
                    <td>
                      {sug ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span className="badge amber">voorgesteld: geen bon</span>
                          <div className="actions">
                            <button className="btn btn-primary btn-sm" disabled={wait} onClick={() => resolve(t.id, 'none_needed')}>Akkoord</button>
                            <button className="btn btn-outline btn-sm" disabled={wait} onClick={() => resolve(t.id, 'open')}>Toch bon nodig</button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn btn-outline btn-sm" disabled={wait} onClick={() => resolve(t.id, 'none_needed')}>
                          ✓ Geen bon nodig
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {noneNeeded.length > 0 && (
        <>
          <h2 className="section-title">Gemarkeerd als “geen bon nodig” ({noneNeeded.length})</h2>
          <div className="table-wrap">
            <table className="tbl">
              <colgroup>
                <col style={{ width: 104 }} /><col style={{ width: 116 }} />
                <col style={{ width: '24%' }} /><col /><col style={{ width: 180 }} />
              </colgroup>
              <thead>
                <tr><th>Datum</th><th style={{ textAlign: 'right' }}>Bedrag</th><th>Tegenpartij</th><th>Omschrijving</th><th>Actie</th></tr>
              </thead>
              <tbody>
                {noneNeeded.map((t) => (
                  <tr key={t.id}>
                    <td className="nowrap">{t.tx_date}</td>
                    <td className="num-cell amount-out">€ {fmt(Math.abs(Number(t.amount)))}</td>
                    <td className="wrap">{t.counterparty || <span className="muted">—</span>}</td>
                    <td className="wrap">{t.description || <span className="muted">—</span>}</td>
                    <td>
                      <button className="btn btn-danger-ghost btn-sm" disabled={pendingId === t.id} onClick={() => resolve(t.id, 'open')}>
                        Terugzetten
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="section-title">Bonnen zonder transactie</h2>
      {docsWithout.length === 0 ? (
        <div className="empty">✓ Elke bon is gekoppeld.</div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <colgroup>
              <col style={{ width: 104 }} /><col style={{ width: 116 }} />
              <col style={{ width: '24%' }} /><col />
            </colgroup>
            <thead>
              <tr><th>Datum</th><th style={{ textAlign: 'right' }}>Bedrag</th><th>Leverancier</th><th>Bestand</th></tr>
            </thead>
            <tbody>
              {docsWithout.map((d) => (
                <tr key={d.id}>
                  <td className="nowrap">{d.doc_date || <span className="muted">—</span>}</td>
                  <td className="num-cell">{d.amount != null ? `€ ${fmt(Number(d.amount))}` : <span className="muted">—</span>}</td>
                  <td className="wrap">{d.vendor || <span className="muted">—</span>}</td>
                  <td className="wrap">{d.attachment_name || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// --- Tab: alle boekingen --------------------------------------------------

function AllTab({ rows }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <colgroup>
          <col style={{ width: 104 }} /><col style={{ width: 120 }} />
          <col style={{ width: '26%' }} /><col /><col style={{ width: 180 }} />
        </colgroup>
        <thead>
          <tr><th>Datum</th><th style={{ textAlign: 'right' }}>Bedrag</th><th>Tegenpartij</th><th>Omschrijving</th><th>Bon</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const amt = Number(t.amount);
            return (
              <tr key={t.id}>
                <td className="nowrap">{t.tx_date}</td>
                <td className={`num-cell ${amt < 0 ? 'amount-out' : 'amount-in'}`}>
                  {amt < 0 ? '−' : '+'} € {fmt(Math.abs(amt))}
                </td>
                <td className="wrap">{t.counterparty || <span className="muted">—</span>}</td>
                <td className="wrap">{t.description || <span className="muted">—</span>}</td>
                <td>{bonBadge(t)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function bonBadge(t) {
  if (t.matched_doc_id) return <span className="badge green">● bon gekoppeld</span>;
  if (Number(t.amount) >= 0) return <span className="badge gray">bijschrijving</span>;
  if (t.receipt_status === 'none_needed') return <span className="badge gray">geen bon nodig</span>;
  if (t.receipt_status === 'suggested_none') return <span className="badge blue">geen bon?</span>;
  return <span className="badge amber">bon nodig</span>;
}

function fmt(n) {
  return Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
