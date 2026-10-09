/**
 * Database error classification and timeout enforcement.
 */

import { ErrorCodes } from "../shared-types.js";
import { config } from "../config.js";

export class DatabaseProvisioningError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const getDatabaseHostConnectTimeoutMs = () => {
  const raw = config.database.hostConnectTimeoutMs;
  return raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : 5000;
};
