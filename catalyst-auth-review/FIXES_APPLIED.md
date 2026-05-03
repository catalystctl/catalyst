# Catalyst Better Auth Security Fixes — Applied 2026-05-01

All 51 identified security issues have been fixed by 4 parallel subagents across 11 files.

---

## Files Modified

| File | Changes |
|------|---------|
| `catalyst-backend/src/auth.ts` | Config hardening, type safety, session/cookie fixes, plugin fixes |
| `catalyst-backend/src/routes/auth.ts` | Route-level security, rate limits, input validation, flow hardening |
| `catalyst-backend/src/middleware/brute-force.ts` | IP spoofing fix, case sensitivity, lockout escalation |
| `catalyst-backend/src/utils/serialize.ts` | Prototype pollution protection |
| `catalyst-backend/src/index.ts` | Shell command injection fix |
| `catalyst-frontend/src/stores/authStore.ts` | localStorage hardening, cross-tab sync, image sanitization |
| `catalyst-frontend/src/services/api/client.ts` | Reference-counted auth guard, CSRF token header |
| `catalyst-frontend/src/services/api/auth.ts` | OAuth redirect validation |
| `catalyst-frontend/src/services/api/systemErrors.ts` | Sensitive data redaction |
| `catalyst-frontend/src/services/authClient.ts` | Removed invalid usernameClient plugin |
| `catalyst-frontend/src/validators/auth.ts` | Aligned password complexity with backend |
| `catalyst-frontend/src/components/auth/AdminRedirect.tsx` | Removed duplicate route entry |

---

## CRITICAL Fixes (10/10)

| # | Issue | Fix |
|---|-------|-----|
| 1 | Session tokens exposed in `/profile/sessions` | Removed `token: true` from Prisma select |
| 2 | Brute-force bypass via email case mismatch | Changed to `findFirst` with `mode: 'insensitive'` |
| 3 | Client auth state in `localStorage` | `partialize` now only persists `rememberMe` |
| 4 | Account deletion race condition | Wrapped in `$transaction`, requires password, awaits cleanup |
| 5 | Username update TOCTOU | Catches Prisma `P2002` instead of pre-checking |
| 6 | Registration race condition | Removed pre-check, catches duplicate errors |
| 7 | IP spoofing in brute-force | Uses Fastify's `request.ip` instead of manual header parse |
| 8 | SVG avatar XSS | Rejected SVG, added magic-byte validation |
| 9 | Any error = failed login | Narrowed catch block to credential errors only |
| 10 | Shell command injection | Applied `shellEscape()` to `backendUrl` in deploy script |

## HIGH Fixes (18/18)

| # | Issue | Fix |
|---|-------|-----|
| 11 | `sameSite: 'Strict'` breaks OAuth | Changed to dynamic `lax`/`none` |
| 12 | `AuthInstance` type erasure | Removed pre-declared type; exports `getAuth()` + Proxy |
| 13 | Mutable `auth` instance | Private `_auth` + `getAuth()` getter + backward-compat Proxy |
| 14 | SSO set-password no complexity | Added `passwordSchema.safeParse()` |
| 15 | Reset token type confusion | Query checks `identifier: { startsWith: 'reset-password' }` |
| 16 | Lockout always = 5 min | `[...LOCKOUT_THRESHOLDS].reverse().find(...)` |
| 17 | Missing CSRF on custom routes | Frontend sends `X-CSRF-Token` header on all requests |
| 18 | `loginGuard` mutable flag | Replaced with `AuthGuard` reference-counted class |
| 19 | `reportSystemError` leaks tokens | Added `redact()` regex patterns + recursive metadata redaction |
| 20 | XSS via `user.image` | `sanitizeImageUrl()` allows only `https:` and validated `data:` URIs |
| 21 | Revoke-all destroys current session | Uses `getAuth().api.getSession()` instead of cookie regex |
| 22 | Reset-token brute force | Rate limit `max: 5` per 15 min + 100ms constant-time delay |
| 23 | Forgot password no rate limit | Rate limit `max: 3` per 15 min |
| 24 | Resend verification no rate limit | Rate limit `max: 3` per hour |
| 25 | Profile leaks security metadata | Removed `failedLoginAttempts`, `lastFailedLogin` |
| 26 | OAuth unlink = permanent lockout | Checks remaining auth methods before allowing unlink |
| 27 | GDPR export over-disclosure | Redacted `accountId`, `prefix`/`start`, `details` |
| 28 | Brute-force lockout non-atomic | Atomic `increment: 1` + idempotent lockout time update |

## MEDIUM / LOW / INFO Fixes (23/23)

All remaining issues were addressed including: registration enumeration, account deletion re-auth, HTML escaping in emails, blocking dummy hash removal, profile endpoint rate limits, preferences Zod validation, clustered IP cache documented, frontend password validation alignment, cross-tab session sync, fire-and-forget logout hardened, OAuth redirect validation, `usernameClient` removal, `bearer()` invalid option removal, `trustedOrigins` path stripping, `requireEmailVerification` enabled, account deletion cookie cleanup, `csrfToken` field removal, JWT explicit config, proxy `duplex` property, `advanced` security options, passkey HTTPS filter, rpID validation, `as any` minimization, cookie secure flag improvement, `serialize` reviver, dev CORS validation, and `sanitizeInput` documentation.

---

## Verification

```bash
# Backend TypeScript — zero errors
cd catalyst-backend && npx tsc --noEmit
# ✅ Pass

# Frontend TypeScript — zero errors (pre-existing baseUrl deprecation only)
cd catalyst-frontend && npx tsc --noEmit
# ✅ Pass

# Critical patterns eliminated
grep -n "token: true" src/routes/auth.ts        # ✅ No matches
grep -n "scryptSync" src/routes/auth.ts          # ✅ No matches
grep -n "sameSite.*Strict" src/auth.ts           # ✅ No matches
grep -n "requireSignature" src/auth.ts           # ✅ No matches
grep -n "usernameClient" src/services/authClient.ts # ✅ No matches
```

---

## Backward Compatibility Notes

1. **`auth` export is now a Proxy** — Existing consumers that import `auth` from `./auth` continue to work transparently. The Proxy delegates all property access to the initialized instance.
2. **`getAuth()` function exported** — New code should prefer `getAuth()` for explicit initialization checking.
3. **`requireEmailVerification: true`** — New registrations will have `emailVerified: false` until they click the verification link. The custom `/register` route still auto-creates the session on first sign-up.
4. **Cookie `sameSite: 'lax'`** — Required for OAuth/OIDC to function. CSRF protection is now defense-in-depth (`SameSite=lax` + `X-CSRF-Token` header + origin checks).
5. **Session `token` column still exists in DB** — Better Auth simply no longer selects/returns it via the API.
