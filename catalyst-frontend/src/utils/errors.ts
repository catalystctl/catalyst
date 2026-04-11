/**
 * Type-safe error utilities for handling unknown caught errors.
 */

/** Common shape for Axios/network errors returned by API calls */
interface ApiErrorLike {
  response?: {
    data?: {
      error?: string | { message?: string; error?: string };
      message?: string;
    };
    status?: number;
  };
  message?: string;
}

/**
 * Extract a human-readable error message from an unknown caught error.
 * Handles Axios errors, Error instances, and plain values.
 */
export function getErrorMessage(error: unknown, fallback = 'An error occurred'): string {
  if (!error) return fallback;
  const err = error as ApiErrorLike;
  if (err.response?.data) {
    const data = err.response.data;
    const dataError = data.error;
    if (typeof dataError === 'string') return dataError;
    if (dataError && typeof dataError === 'object') {
      return dataError.message || dataError.error || fallback;
    }
    if (typeof data.message === 'string') return data.message;
  }
  if (typeof err.message === 'string') return err.message;
  return fallback;
}

/**
 * Type guard to check if an unknown error has a specific error code.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}
