/**
 * {{displayName}} — React Components
 *
 * Admin and server tab components for the Catalyst frontend.
 */

import React from 'react';

export function AdminTab() {
  const [status, setStatus] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch('/api/plugins/{{name}}/stats')
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
            border: '1px solid #333',
            background: '#1a1a1a',
          }}
        >
          <pre style={{ margin: 0, fontSize: '0.85rem' }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        </div>
      ) : (
        <p>Could not load plugin status.</p>
      )}
    </div>
  );
}

export function ServerTab() {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
        {{displayName}}
      </h2>
      <p style={{ color: '#888' }}>
        Server tab injected by the {{name}} plugin.
      </p>
    </div>
  );
}
