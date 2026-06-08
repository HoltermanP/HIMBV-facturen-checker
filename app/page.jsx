'use client';

import { useEffect, useRef, useState } from 'react';

// Mobielvriendelijke client: drag-and-drop, bestand kiezen, foto maken.
// INTAKE_SECRET wordt door de gebruiker ingevuld en in localStorage bewaard.
export default function Home() {
  const [secret, setSecret] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [items, setItems] = useState([]); // { id, filename, status, vendor, amount, doc_date, error }
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const cameraInput = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem('INTAKE_SECRET') || '';
    setSecret(saved);
    if (!saved) setShowSettings(true);
  }, []);

  function saveSecret(v) {
    setSecret(v);
    localStorage.setItem('INTAKE_SECRET', v);
  }

  async function upload(files) {
    if (!files || files.length === 0) return;
    if (!secret) {
      setShowSettings(true);
      return;
    }

    // Optimistische statusregels.
    const pending = Array.from(files).map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      filename: f.name,
      status: 'uploaden…',
    }));
    setItems((prev) => [...pending, ...prev]);

    const form = new FormData();
    for (const f of files) form.append('file', f);

    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        body: form,
      });

      if (res.status === 401) {
        markPending(pending, { status: 'fout', error: 'ongeldige INTAKE_SECRET' });
        setShowSettings(true);
        return;
      }

      const data = await res.json().catch(() => ({}));
      const results = data.results || [];

      // Resultaten terugkoppelen per bestandsnaam.
      setItems((prev) => {
        const next = [...prev];
        for (const p of pending) {
          const r = results.find((x) => x.filename === p.filename);
          const idx = next.findIndex((n) => n.id === p.id);
          if (idx !== -1) {
            next[idx] = r
              ? {
                  ...next[idx],
                  status: r.status,
                  vendor: r.vendor ?? null,
                  amount: r.amount ?? null,
                  doc_date: r.doc_date ?? null,
                  error: r.error || r.reason || null,
                }
              : { ...next[idx], status: 'fout', error: 'geen resultaat' };
          }
        }
        return next;
      });
    } catch (err) {
      markPending(pending, { status: 'fout', error: String(err.message || err) });
    }
  }

  function markPending(pending, patch) {
    setItems((prev) =>
      prev.map((n) => (pending.some((p) => p.id === n.id) ? { ...n, ...patch } : n)),
    );
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    upload(e.dataTransfer.files);
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 60px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Bonnen &amp; Facturen</h1>
        <button onClick={() => setShowSettings((s) => !s)} style={btnGhost}>
          Instellingen
        </button>
      </header>
      <p style={{ color: '#5b6470', marginTop: 6 }}>
        Stuur een bon of factuur door naar Basecone. Foto maken, of bestanden uploaden.
      </p>

      {showSettings && (
        <section style={card}>
          <label style={{ fontWeight: 600, fontSize: 14 }}>INTAKE_SECRET</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => saveSecret(e.target.value)}
            placeholder="plak hier je token"
            style={input}
          />
          <p style={{ color: '#5b6470', fontSize: 13, margin: '6px 0 0' }}>
            Wordt alleen in deze browser bewaard en meegestuurd als Bearer-token.
          </p>
        </section>
      )}

      {/* Drag-and-drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          ...dropzone,
          borderColor: dragOver ? '#2563eb' : '#cbd5e1',
          background: dragOver ? '#eef4ff' : '#fff',
        }}
      >
        <p style={{ margin: '0 0 14px', color: '#5b6470' }}>
          Sleep bestanden hierheen, of:
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => cameraInput.current?.click()} style={btnPrimary}>
            📷 Foto maken
          </button>
          <button onClick={() => fileInput.current?.click()} style={btnSecondary}>
            📎 Bestanden kiezen
          </button>
        </div>

        {/* Verborgen inputs */}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Statuslijst */}
      <section style={{ marginTop: 22 }}>
        {items.map((it) => (
          <div key={it.id} style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.filename}
              </div>
              <div style={{ fontSize: 13, color: '#5b6470' }}>
                {it.vendor ? `${it.vendor} · ` : ''}
                {it.amount != null ? `€ ${it.amount} · ` : ''}
                {it.doc_date || ''}
                {it.error ? ` — ${it.error}` : ''}
              </div>
            </div>
            <span style={badge(it.status)}>{statusLabel(it.status)}</span>
          </div>
        ))}
      </section>
    </main>
  );
}

function statusLabel(s) {
  if (s === 'sent') return 'verstuurd';
  if (s === 'skipped') return 'overgeslagen';
  if (s === 'error') return 'fout';
  return s;
}

// --- styling ---------------------------------------------------------------
const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginTop: 14 };
const input = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', marginTop: 6, fontSize: 16 };
const dropzone = { marginTop: 16, border: '2px dashed #cbd5e1', borderRadius: 14, padding: '28px 16px', textAlign: 'center', transition: 'all .15s' };
const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
const btnBase = { padding: '10px 16px', borderRadius: 10, fontSize: 15, cursor: 'pointer', border: '1px solid transparent' };
const btnPrimary = { ...btnBase, background: '#2563eb', color: '#fff' };
const btnSecondary = { ...btnBase, background: '#fff', color: '#1c1f23', border: '1px solid #cbd5e1' };
const btnGhost = { ...btnBase, background: 'transparent', color: '#2563eb', padding: '6px 10px' };

function badge(status) {
  const map = {
    sent: { bg: '#dcfce7', fg: '#166534' },
    skipped: { bg: '#fef9c3', fg: '#854d0e' },
    error: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const c = map[status] || { bg: '#e5e7eb', fg: '#374151' };
  return { background: c.bg, color: c.fg, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' };
}
