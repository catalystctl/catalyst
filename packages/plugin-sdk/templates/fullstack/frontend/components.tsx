/**
 * {{displayName}} — React Components
 *
 * Admin and server tab components for the Catalyst frontend.
 */

import React from 'react';

// ── Admin Tab ─────────────────────────────────────────────────────────────

export function AdminTab() {
  const [status, setStatus] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch('/api/plugins/{{name}}/status')
      .then((res) => res.json())
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch plugin status:', err);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>
        {{displayName}} — Admin
      </h2>

      {loading ? (
        <p>Loading...</p>
      ) : status?.success ? (
        <div
          style={{
            padding: '1rem',
            borderRadius: '0.5rem',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}
        >
          <p style={{ color: '#22c55e', fontWeight: 600 }}>✅ Plugin is running</p>
          <pre style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        </div>
      ) : (
        <div
          style={{
            padding: '1rem',
            borderRadius: '0.5rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}
        >
          <p style={{ color: '#ef4444', fontWeight: 600 }}>❌ Plugin is not responding</p>
        </div>
      )}
    </div>
  );
}

// ── Server Tab ────────────────────────────────────────────────────────────

export function ServerTab({ serverId }: { serverId: string }) {
  const [message, setMessage] = React.useState('');

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>
        {{displayName}} — Server
      </h2>
      <p style={{ color: '#888', marginBottom: '1rem' }}>
        Server ID: <code>{serverId}</code>
      </p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Enter a message..."
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #444',
            backgroundColor: '#1a1a1a',
            color: '#fff',
          }}
        />
        <button
          onClick={() => {
            console.log('Message:', message, 'Server:', serverId);
            setMessage('');
          }}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '0.375rem',
            border: 'none',
            backgroundColor: '#2563eb',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
