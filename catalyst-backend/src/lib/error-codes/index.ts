import { AuthErrorCodes } from './auth.js';
import { ServerErrorCodes } from './servers.js';
import { InfrastructureErrorCodes } from './infrastructure.js';
import { AdminErrorCodes } from './admin.js';
import { CommonErrorCodes } from './common.js';

/**
 * The single registry of stable API error codes.
 *
 * Route handlers attach a code to every error response (see `apiError` in
 * lib/http-error.ts). The frontend translates the code it recognizes and falls
 * back to the English `error` message otherwise, so adding a code is additive
 * and never breaks older clients.
 */
export const ErrorCodes = {
  ...CommonErrorCodes,
  ...AuthErrorCodes,
  ...ServerErrorCodes,
  ...InfrastructureErrorCodes,
  ...AdminErrorCodes,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export {
  AuthErrorCodes,
  ServerErrorCodes,
  InfrastructureErrorCodes,
  AdminErrorCodes,
  CommonErrorCodes,
};
