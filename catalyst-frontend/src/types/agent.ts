/**
 * Types for agent control, monitoring, and diagnostics.
 */

export interface AgentStatus {
  nodeId: string;
  connected: boolean;
  agentVersion: string | null;
  panelVersion: string | null;
  updateAvailable: boolean;
  latestVersion: string | null;
  uptime: number | null;           // seconds since agent process started
  lastSeenAt: string | null;
  osInfo: string | null;           // e.g. "Ubuntu 22.04 x86_64"
  kernelVersion: string | null;
  containerRuntime: string | null;  // e.g. "containerd 1.7.2"
  runningContainers: number;
  totalContainers: number;
  configPath: string | null;
  sftpPort: number | null;
  sftpEnabled: boolean;
}

export interface AgentLogEntry {
  timestamp: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  target: string;       // Rust module path, e.g. "catalyst_agent::websocket_handler"
  message: string;
  fields?: Record<string, string>;
}

export interface AgentConfig {
  path: string;
  content: string;
  lastModified: string | null;
}

export interface AgentUpdateStatus {
  currentVersion: string;
  targetVersion: string;
  status: 'idle' | 'checking' | 'downloading' | 'updating' | 'restarting' | 'failed';
  progress: number;     // 0-100
  error: string | null;
  startedAt: string | null;
}

export interface AgentHealthReport {
  nodeId: string;
  timestamp: string;
  cpuPercent: number;
  memoryUsageMb: number;
  memoryTotalMb: number;
  diskUsageMb: number;
  diskTotalMb: number;
  runningContainers: number;
  totalContainers: number;
  uptime: number;
  agentVersion: string;
  osInfo: string;
  kernelVersion: string;
  containerdVersion: string;
  sftpPort: number;
  sftpEnabled: boolean;
}

export type AgentActionStatus = 'idle' | 'pending' | 'success' | 'failed';

export interface AgentActionResult {
  action: string;
  status: AgentActionStatus;
  message: string;
  timestamp: string;
}
