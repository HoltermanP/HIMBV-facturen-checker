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
            <div className="num">{c.openOut}</div>
            <div className="lbl">Bon ophalen (inkoop){c.outTotal ? ` · € ${fmt(c.outTotal)}` : ''}</div>
          </div>
          <div className="stat purple">
            <div className="num">{c.openIn}</div>
            <div className="lbl">Factuur ontbreekt (verkoop){c.inTotal ? ` · € ${fmt(c.inTotal)}` : ''}</div>
          </div>
          <div className="stat blue">
            <div className="num">{c.suggested}</div>
            <div className="lbl">Ter goedkeuring (geen document?)</div>
          </div>
          <div className="stat green">
            <div className="num">{c.matched}</div>
            <div className="lbl">Document gekoppeld</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      {report && (
        <div className="tabs" style={{ marginBottom: 18 }}>
          <button className={`tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
            Openstaand{c ? ` (${c.openOut + c.openIn + c.suggested})` : ''}
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
  const items = report.items || [];
  const noneNeeded = report.noneNeeded || [];
  const docsWithout = report.docsWithout || [];

  return (
    <>
      <h2 className="section-title">Openstaande posten</h2>
      <p className="subtitle" style={{ marginTop: -4, marginBottom: 12 }}>
        Uitgaven hebben een <b>inkoopbon</b> nodig, bijschrijvingen een <b>uitgaande factuur</b>.
      </p>
      {items.length === 0 ? (
        <div className="empty">✓ Alles afgehandeld — geen openstaande posten.</div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <colgroup>
              <col style={{ width: 104 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: '24%' }} />
              <col />
              <col style={{ width: 270 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Datum</th><th style={{ textAlign: 'right' }}>Bedrag</th>
                <th>Tegenpartij</th><th>Omschrijving</th><th>Nodig / actie</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const sug = t.receipt_status === 'suggested_none';
                const wait = pendingId === t.id;
                const isOut = Number(t.amount) < 0;
                const docWord = isOut ? 'bon' : 'factuur'; // inkoopbon vs uitgaande factuur
                return (
                  <tr key={t.id} className={sug ? 'row-suggested' : ''}>
                    <td className="nowrap">{t.tx_date}</td>
                    <td className={`num-cell ${isOut ? 'amount-out' : 'amount-in'}`}>
                      {isOut ? '−' : '+'} € {fmt(Math.abs(Number(t.amount)))}
                    </td>
                    <td className="wrap">{t.counterparty || <span className="muted">—</span>}</td>
                    <td className="wrap">{t.description || <span className="muted">—</span>}</td>
                    <td>
                      {sug ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span className="badge amber">voorgesteld: geen {docWord}</span>
                          <div className="actions">
                            <button className="btn btn-primary btn-sm" disabled={wait} onClick={() => resolve(t.id, 'none_needed')}>Akkoord</button>
                            <button className="btn btn-outline btn-sm" disabled={wait} onClick={() => resolve(t.id, 'open')}>Toch {docWord} nodig</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span className={`badge ${isOut ? 'amber' : 'purple'}`}>{isOut ? 'inkoopbon nodig' : 'verkoopfactuur nodig'}</span>
                          <button className="btn btn-outline btn-sm" disabled={wait} onClick={() => resolve(t.id, 'none_needed')}>
                            ✓ Geen {docWord} nodig
                          </button>
                        </div>
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
          <h2 className="section-title">Gemarkeerd als “geen document nodig” ({noneNeeded.length})</h2>
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
                {noneNeeded.map((t) => {
                  const isOut = Number(t.amount) < 0;
                  return (
                    <tr key={t.id}>
                      <td className="nowrap">{t.tx_date}</td>
                      <td className={`num-cell ${isOut ? 'amount-out' : 'amount-in'}`}>
                        {isOut ? '−' : '+'} € {fmt(Math.abs(Number(t.amount)))}
                      </td>
                      <td className="wrap">{t.counterparty || <span className="muted">—</span>}</td>
                      <td className="wrap">{t.description || <span className="muted">—</span>}</td>
                      <td>
                        <button className="btn btn-danger-ghost btn-sm" disabled={pendingId === t.id} onClick={() => resolve(t.id, 'open')}>
                          Terugzetten
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
  const isOut = Number(t.amount) < 0;
  const docWord = isOut ? 'bon' : 'factuur';
  if (t.matched_doc_id) return <span className="badge green">● document gekoppeld</span>;
  if (t.receipt_status === 'none_needed') return <span className="badge gray">geen {docWord} nodig</span>;
  if (t.receipt_status === 'suggested_none') return <span className="badge blue">geen {docWord}?</span>;
  return <span className={`badge ${isOut ? 'amber' : 'purple'}`}>{isOut ? 'inkoopbon nodig' : 'verkoopfactuur nodig'}</span>;
}

function fmt(n) {
  return Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
