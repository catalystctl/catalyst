export type WebSocketMessage =
  | {
      type: 'error';
      error: string;
      serverId?: string;
      timestamp?: number | string;
    }
  | {
      type: 'console_output';
      serverId: string;
      stream?: string;
      data: string;
      timestamp?: number | string;
    }
  | {
      type: 'server_log';
      serverId: string;
      line: string;
      timestamp?: number | string;
    }
  | {
    type: 'server_state_update' | 'server_state';
    serverId: string;
    state: string;
    reason?: string;
    timestamp?: number | string;
    portBindings?: Record<number, number>;
    exitCode?: number;
  }
  | {
      type: 'resource_stats';
      serverId: string;
      cpuPercent?: number;
      memoryUsageMb?: number;
      networkRxBytes?: number;
      networkTxBytes?: number;
      diskIoMb?: number;
      diskUsageMb?: number;
      diskTotalMb?: number;
      cpu?: number;
      memory?: number;
    }
  | {
      type: 'backup_complete' | 'backup_restore_complete' | 'backup_delete_complete';
      serverId: string;
      backupName?: string;
      backupPath?: string;
      sizeMb?: number;
      checksum?: string | null;
      backupId?: string;
    }
  | {
      type: 'storage_resize_complete';
      serverId: string;
      serverUuid?: string;
      allocatedDiskMb?: number;
      success: boolean;
      error?: string;
    }
  | {
      type: 'eula_required';
      serverId: string;
      serverUuid?: string;
      eulaText?: string;
      timestamp?: number | string;
    };
