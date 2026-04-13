import React from 'react';

/**
 * Example Admin Tab Component
 * 
 * This tab appears in the admin panel when the plugin is enabled
 */
export function AdminTab() {
  const [counter, setCounter] = React.useState(0);
  const [stats, setStats] = React.useState<any>(null);
  
  React.useEffect(() => {
    // Fetch plugin stats
    fetch('/api/plugins/example-plugin/stats')
      .then(res => res.json())
      .then(data => setStats(data.stats))
      .catch(err => console.error('Failed to fetch stats:', err));
  }, []);
  
  const handleTestClick = async () => {
    const response = await fetch('/api/plugins/example-plugin/hello');
    const data = await response.json();
    setCounter(data.requestCount);
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Example Plugin Admin Tab</h2>
        <p className="text-gray-400">
          This tab was injected by the example plugin to demonstrate tab functionality.
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold mb-4">Plugin Statistics</h3>
          {stats ? (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Request Count:</span>
                <span className="font-mono">{stats.requestCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Task Runs:</span>
                <span className="font-mono">{stats.taskRunCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Uptime:</span>
                <span className="font-mono">{Math.floor(stats.uptime)}s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Installed:</span>
                <span className="font-mono text-sm">
                  {stats.installDate ? new Date(stats.installDate).toLocaleDateString() : 'N/A'}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-gray-400">Loading...</div>
          )}
        </div>
        
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold mb-4">Test Plugin API</h3>
          <div className="space-y-4">
            <button
              onClick={handleTestClick}
              className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
            >
              Test Hello Endpoint
            </button>
            {counter > 0 && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-green-400 text-sm">
                  Response received! Request count: <strong>{counter}</strong>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2 text-blue-400">💡 Developer Note</h3>
        <p className="text-sm text-gray-300">
          This admin tab demonstrates how plugins can extend the admin interface with custom functionality.
          Plugins can add multiple tabs, each with their own components and logic.
        </p>
      </div>
    </div>
  );
}

/**
 * Example Server Tab Component
 * 
 * This tab appears in server detail pages when the plugin is enabled
 */
export function ServerTab({ serverId }: { serverId: string }) {
  const [message, setMessage] = React.useState('');
  const [responses, setResponses] = React.useState<any[]>([]);
  
  const handleEcho = async () => {
    if (!message) return;
    
    const response = await fetch('/api/plugins/example-plugin/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId,
        message,
        timestamp: new Date().toISOString(),
      }),
    });
    
    const data = await response.json();
    setResponses(prev => [data, ...prev].slice(0, 5));
    setMessage('');
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Example Plugin Server Tab</h2>
        <p className="text-gray-400">
          This tab was injected into the server details page by the example plugin.
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Server ID: <code className="bg-gray-800 px-2 py-0.5 rounded">{serverId}</code>
        </p>
      </div>
      
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Echo Test</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Message to Echo
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleEcho()}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={handleEcho}
                disabled={!message}
                className="px-6 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </div>
          
          {responses.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-400">Recent Responses:</h4>
              {responses.map((resp, idx) => (
                <div key={idx} className="p-3 bg-gray-700/50 rounded border border-gray-600">
                  <pre className="text-xs text-gray-300 overflow-x-auto">
                    {JSON.stringify(resp.echoed, null, 2)}
                  </pre>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(resp.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2 text-purple-400">🚀 Plugin Context</h3>
        <p className="text-sm text-gray-300">
          Server-specific tabs receive the <code className="bg-gray-800 px-1 rounded">serverId</code> prop,
          allowing plugins to provide server-specific functionality and data.
        </p>
      </div>
    </div>
  );
}
