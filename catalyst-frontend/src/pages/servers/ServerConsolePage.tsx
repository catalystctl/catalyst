import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowDown, Check, Copy, Search, Trash2, X, Terminal } from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerStatusBadge from '../../components/servers/ServerStatusBadge';
import CustomConsole from '../../components/console/CustomConsole';
import { useConsole } from '../../hooks/useConsole';
import { useServer } from '../../hooks/useServer';
import { useEulaPrompt } from '../../hooks/useEulaPrompt';
import EulaModal from '../../components/servers/EulaModal';

const ALL_STREAMS = ['stdout', 'stderr', 'system', 'stdin'] as const;
const STREAM_COLORS: Record<string, { dot: string; active: string; inactive: string }> = {
 stdout: {
 dot: 'bg-success',
 active: 'border-success/50 bg-success-muted text-success',
 inactive: 'border-border/30 text-muted-foreground hover:border-primary/30',
 },
 stderr: {
 dot: 'bg-danger',
 active: 'border-danger/50 bg-danger-muted text-danger',
 inactive: 'border-border/30 text-muted-foreground hover:border-primary/30',
 },
 system: {
 dot: 'bg-info',
 active: 'border-info/50 bg-info-muted text-info',
 inactive: 'border-border/30 text-muted-foreground hover:border-primary/30',
 },
 stdin: {
 dot: 'bg-warning',
 active: 'border-warning/50 bg-warning-muted text-warning',
 inactive: 'border-border/30 text-muted-foreground hover:border-primary/30',
 },
};

function ServerConsolePage() {
 const { serverId } = useParams();
 const { data: server } = useServer(serverId);
 const { entries, send, isConnected, isConnecting, isLoading, isError, refetch, clear, streamStatus } = useConsole(serverId);
 const { eulaPrompt, isLoading: eulaLoading, respond: respondEula } = useEulaPrompt(serverId);

 const [command, setCommand] = useState('');
 const [autoScroll, setAutoScroll] = useState(true);
 const [searchQuery, setSearchQuery] = useState('');
 const [searchOpen, setSearchOpen] = useState(false);
 const [activeStreams, setActiveStreams] = useState<Set<string>>(() => new Set(ALL_STREAMS));
 const [commandHistory, setCommandHistory] = useState<string[]>([]);
 const [historyIndex, setHistoryIndex] = useState(-1);
 const [copied, setCopied] = useState(false);

 const inputRef = useRef<HTMLInputElement>(null);
 const searchRef = useRef<HTMLInputElement>(null);

 const title = server?.name ?? serverId ?? 'Unknown server';
 const isSuspended = server?.status === 'suspended';
 // canSend: allow commands when SSE is connected (or reconnecting) AND server is running
 const canSend = Boolean(serverId) && (isConnected || streamStatus === 'reconnecting') && server?.status === 'running' && !isSuspended;

 useEffect(() => {
 // eslint-disable-next-line react-hooks/set-state-in-effect
 setAutoScroll(true);
 }, [serverId]);

 const handleSubmit = (e: FormEvent) => {
 e.preventDefault();
 if (!canSend || !command.trim()) return;
 send(command);
 setCommandHistory((prev) => [...prev.slice(-49), command]);
 setCommand('');
 setHistoryIndex(-1);
 setAutoScroll(true);
 };

 const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
 if (e.key === 'ArrowUp') {
 e.preventDefault();
 if (commandHistory.length === 0) return;
 const next = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
 setHistoryIndex(next);
 setCommand(commandHistory[next]);
 } else if (e.key === 'ArrowDown') {
 e.preventDefault();
 if (historyIndex === -1) return;
 const next = historyIndex + 1;
 if (next >= commandHistory.length) {
 setHistoryIndex(-1);
 setCommand('');
 } else {
 setHistoryIndex(next);
 setCommand(commandHistory[next]);
 }
 }
 };

 const toggleStream = (stream: string) => {
 setActiveStreams((prev) => {
 const next = new Set(prev);
 if (next.has(stream)) {
 if (next.size > 1) next.delete(stream);
 } else {
 next.add(stream);
 }
 return next;
 });
 };

 const handleCopy = async () => {
 const text = entries
 .filter((e) => activeStreams.has(e.stream))
 .map((e) => e.data)
 .join('');
 await navigator.clipboard.writeText(text);
 setCopied(true);
 setTimeout(() => setCopied(false), 2000);
 };

 const handleClear = () => {
 clear();
 setAutoScroll(true);
 };

 // Ctrl+F / Escape for search
 useEffect(() => {
 const onKeyDown = (e: globalThis.KeyboardEvent) => {
 if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
 e.preventDefault();
 setSearchOpen(true);
 setTimeout(() => searchRef.current?.focus(), 50);
 }
 if (e.key === 'Escape' && searchOpen) {
 setSearchOpen(false);
 setSearchQuery('');
 inputRef.current?.focus();
 }
 };
 window.addEventListener('keydown', onKeyDown);
 return () => window.removeEventListener('keydown', onKeyDown);
 }, [searchOpen]);

 return (
 <div className="flex min-h-[calc(100vh-10rem)] flex-col gap-4">
 <TabHeader
 icon={Terminal}
 title="Console"
 description="Real-time output and command input"
 variant={isSuspended ? 'danger' : server?.status === 'running' ? 'success' : 'default'}
 actions={
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium text-muted-foreground">{title}</span>
 {server?.status ? <ServerStatusBadge status={server.status} /> : null}
 </div>
 }
 />

 {isSuspended ? (
 <div className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
 Server suspended — console input disabled.
 </div>
 ) : null}

 {/* Console Container */}
 <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/40">
 {/* Toolbar */}
 <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-card px-3 py-2">
 {/* Connection Status */}
 <span
 className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
 streamStatus === 'connected'
 ? 'border-success/50 text-success'
 : streamStatus === 'reconnecting'
 ? 'border-warning/30 text-warning'
 : 'border-border/30 text-muted-foreground'
 }`}
 >
 <span
 className={`h-1.5 w-1.5 rounded-full ${
 streamStatus === 'connected'
 ? 'animate-pulse bg-success'
 : streamStatus === 'reconnecting'
 ? 'animate-pulse bg-warning'
 : 'bg-muted'
 }`}
 />
 {streamStatus === 'connected' ? 'Live' : streamStatus === 'reconnecting' ? 'Reconnecting' : streamStatus === 'closed' ? 'Disconnected' : 'Connecting'}
 </span>

 <div className="h-4 w-px bg-surface-3" />

 {/* Stream Filters */}
 <div className="flex items-center gap-1">
 {ALL_STREAMS.map((stream) => {
 const colors = STREAM_COLORS[stream];
 const isActive = activeStreams.has(stream);
 return (
 <button
 key={stream}
 type="button"
 onClick={() => toggleStream(stream)}
 className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-all ${
 isActive ? colors.active : colors.inactive
 }`}
 >
 <span className={`h-1.5 w-1.5 rounded-full ${isActive ? colors.dot : 'bg-muted-foreground'}`} />
 {stream}
 </button>
 );
 })}
 </div>

 <div className="h-4 w-px bg-surface-3" />

 {/* Search */}
 {searchOpen ? (
 <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-card px-2 py-1">
 <Search className="h-3 w-3 text-muted-foreground" />
 <input
 ref={searchRef}
 className="w-40 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 placeholder="Filter output…"
 />
 {searchQuery ? (
 <span className="text-[10px] tabular-nums text-muted-foreground">
 {entries.filter((e) => activeStreams.has(e.stream) && e.data.toLowerCase().includes(searchQuery.toLowerCase())).length}
 </span>
 ) : null}
 <button
 type="button"
 onClick={() => {
 setSearchOpen(false);
 setSearchQuery('');
 }}
 className="text-muted-foreground hover:text-foreground"
 >
 <X className="h-3 w-3" />
 </button>
 </div>
 ) : (
 <button
 type="button"
 onClick={() => {
 setSearchOpen(true);
 setTimeout(() => searchRef.current?.focus(), 50);
 }}
 className="flex items-center gap-1.5 rounded-md border border-border/30 px-2 py-1 text-[11px] text-muted-foreground transition-all hover:border-primary/30"
 >
 <Search className="h-3 w-3" />
 Search
 </button>
 )}

 <div className="flex-1" />

 {/* Right-side actions */}
 <span className="text-[11px] tabular-nums text-muted-foreground">
 {entries.length} lines
 </span>

 <div className="h-4 w-px bg-surface-3" />

 <button
 type="button"
 onClick={() => setAutoScroll(!autoScroll)}
 className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-all ${
 autoScroll
 ? 'border-primary/30 bg-primary-muted text-primary'
 : 'border-border/30 text-muted-foreground hover:border-primary/30'
 }`}
 >
 <ArrowDown className="h-3 w-3" />
 Auto-scroll
 </button>

 <button
 type="button"
 onClick={handleCopy}
 className="flex items-center gap-1.5 rounded-md border border-border/30 px-2 py-1 text-[11px] text-muted-foreground transition-all hover:border-primary/30"
 >
 {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
 {copied ? 'Copied' : 'Copy'}
 </button>

 <button
 type="button"
 onClick={handleClear}
 className="flex items-center gap-1.5 rounded-md border border-border/30 px-2 py-1 text-[11px] text-muted-foreground transition-all hover:border-danger/30 hover:text-danger"
 >
 <Trash2 className="h-3 w-3" />
 Clear
 </button>
 </div>

 {/* Console Output */}
 <CustomConsole
 entries={entries}
 autoScroll={autoScroll}
 searchQuery={searchQuery}
 streamFilter={activeStreams}
 isLoading={isLoading}
 isError={isError}
 onRetry={refetch}
 onUserScroll={() => setAutoScroll(false)}
 onAutoScrollResume={() => setAutoScroll(true)}
 className="min-h-0 flex-1"
 />

 {/* Command Input */}
 <form
 onSubmit={handleSubmit}
 className="flex items-center gap-3 border-t border-border/40 bg-card px-4 py-2.5"
 >
 <span className="select-none text-sm font-bold text-primary">$</span>
 <input
 ref={inputRef}
 className="w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
 value={command}
 onChange={(e) => {
 setCommand(e.target.value);
 setHistoryIndex(-1);
 }}
 onKeyDown={handleKeyDown}
 placeholder={
 isSuspended
 ? 'Server suspended'
 : canSend
 ? 'Type a command… (↑↓ for history)'
 : 'Connect to send commands'
 }
 disabled={!canSend}
 />
 <button
 type="submit"
 className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
 disabled={!canSend || !command.trim()}
 >
 Send
 </button>
 </form>
 </div>

 {/* EULA Modal */}
 {eulaPrompt && (
 <EulaModal
 eulaText={eulaPrompt.eulaText}
 onAccept={() => respondEula(true)}
 onDecline={() => respondEula(false)}
 isLoading={eulaLoading}
 />
 )}
 </div>
 );
}

export default ServerConsolePage;
