export class DatabaseProvisioningError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const getDatabaseHostConnectTimeoutMs = () => {
  const raw = Number(process.env.DATABASE_HOST_CONNECT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
};
