export type BackupStatus = 'completed' | 'in_progress' | 'failed' | 'restored' | 'unknown';

export interface Backup {
  id: string;
  serverId: string;
  name: string;
  path: string;
  storageMode?: 'local' | 's3' | 'sftp' | 'stream';
  sizeMb: number;
  checksum?: string | null;
  compressed?: boolean;
  /** Pinned backups are exempt from the retention job (count and age). */
  pinned?: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  restoredAt?: string | null;
}

export interface BackupListResponse {
  backups: Backup[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
