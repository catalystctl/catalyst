export interface AvailableDatabaseHost {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface ServerDatabase {
  id: string;
  name: string;
  username: string;
  password: string;
  host: string;
  port: number;
  hostId: string;
  hostName: string;
  createdAt: string;
}

export interface ServerDatabaseResponse {
  success: boolean;
  data: ServerDatabase[];
}
