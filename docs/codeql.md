# CodeQL in this repository

Code scanning runs through the advanced-setup workflow in
[`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml) with the
configuration in [`.github/codeql/codeql-config.yml`](../.github/codeql/codeql-config.yml).

## Configuration

| Setting | Value | Why |
|---------|-------|-----|
| Suite | `security-and-quality` | Broadest built-in suite; contains `security-extended`, which contains the default suite. |
| Languages | `actions`, `javascript-typescript`, `python`, `rust` | All use `build-mode: none`, so no build step is needed. Rust picks up the pinned toolchain from `catalyst-agent/rust-toolchain.toml`. |
| Category | `/language:<lang>` | The standard combined language names — this is what GitHub's managed default setup uploaded. Keeping the identity stable keeps existing alerts tracked instead of restarting them as a new tool entry. |

`security-and-quality` adds quality queries (`js/unused-local-variable`,
`js/trivial-conditional`, `js/overwritten-property`, …) on top of the security
ones. Those are **in scope**: in this repository they have found real dead code,
unreachable cleanup branches and JSON objects where a duplicate key silently
overrode the earlier one. Do not narrow the suite to silence them — fix them.

## The result page is not a task list

An alert on `main` describes the code as of the **last analysis**, not the
working tree. Alerts only move to `fixed` after the next scan of `main`
completes. Never assume an alert is still live because the page says `open`, and
never assume a local fix cleared it — re-run the scan and re-read the alert.

## Dismissals

Dismiss through the API so the reason is recorded next to the alert:

```bash
gh api -X PATCH repos/catalystctl/catalyst/code-scanning/alerts/<number> \
  --input - <<'JSON'
{"state":"dismissed","dismissed_reason":"false positive",
 "dismissed_comment":"<why this specific code cannot be exploited>"}
JSON
```

Rules we hold ourselves to:

- `dismissed_comment` is capped at **280 characters** by the API. A longer
  comment fails the request with HTTP 422 and the alert stays open.
- The comment must name the concrete barrier that makes the finding
  unreachable (a regex allowlist, a middleware registration, a redaction
  function) — not "not exploitable" or "we reviewed it". A dismissal that
  cannot be re-verified from the comment is not finished.
- Prefer a code fix. Dismiss only when the flagged pattern is correct as
  written and changing it would make the code worse.
- Use `won't fix` for accepted risks (for example lab-only scripts bound to
  `0.0.0.0` on purpose), not for analyser blind spots.

### Known false positives

These recur, because each is a case CodeQL cannot model in this codebase.
They are recorded here so the next person recognises them instead of
re-investigating.

| Query | Why it fires | Why it is not a real finding |
|-------|--------------|------------------------------|
| `js/missing-rate-limiting` | The query only recognises `express-rate-limit`; it does not model `@fastify/rate-limit`. | `server.ts` registers `@fastify/rate-limit` with `global: true`, so every route is covered, and individual routes tighten the limit through `config.rateLimit`. A finding here is a signal that a route was *added* under a limiter the query cannot see, not that one is missing. |
| `js/file-access-to-http` | Tracks a config-file read into a `fetch` URL. | The provider `baseUrl` comes from `loadProviderConfig()` / `getModManagerSettings()` — operator-set panel configuration, not request data. Routes are additionally behind authentication and per-server access checks. |
| `js/path-injection` | Cannot see through a two-step guard. | Plugin names must match `PLUGIN_NAME_REGEX` (`/^[a-z0-9-]+$/`, ≤50 chars — no `/`, no `.`), asset names must pass `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/` plus an extension allowlist, and every joined path is re-checked with `path.dirname(candidate) === expectedRoot`. |
| `js/insufficient-password-hash` | Treats any SHA-256 of a string named `apiKey` as password hashing. | These are 256-bit random tokens (`randomBytes(32)`) hashed with HMAC-SHA256 under a dedicated secret plus a per-key random salt. That is correct storage for a high-entropy bearer credential; a slow KDF would add cost without adding security. Truncated digests are used only as non-secret lookup/rate-limit bucket keys. |
| `js/clear-text-logging` | Tracks the credential object into the log call without modelling the redaction. | `configSummary()` reduces the key to a 10-character prefix plus a 4-character suffix, or `***` when short. |
| `rust/hard-coded-cryptographic-value` | Flags any literal used as a key. | The flagged values are `#[cfg(test)]` test keys. Build them by expansion rather than as a literal (see `streaming_test_key()` in `backup_crypto.rs`) so both the query and a reader can tell they are not production key material. |

## Preventing false positives

Most of the recurring noise has one of three causes. All three are avoidable at
the point the code is written.

### 1. Make the guard visible to the analyser

A sanitizer hidden behind an early return still works, but CodeQL cannot follow
it. Prefer a shape the query recognises:

```ts
// Analyser cannot connect `isValidPluginName(name)` to this join.
const dir = path.join(root, name);

// Explicit and analyser-visible: allowlist the input, then re-check the result.
if (!PLUGIN_NAME_REGEX.test(name)) throw new Error('invalid name');
const dir = path.join(root, name);
if (path.dirname(dir) !== root) throw new Error('invalid name');
```

Same for rate limiting: register it where a reviewer will see it applies
globally, and keep the per-route override next to the handler.

### 2. Do not build objects from untrusted keys

`obj[key] = value` with an attacker-influenced `key` can hit `__proto__`.
Use a shape that cannot:

```ts
// Own properties only — a "__proto__" key stays a plain key.
const out = Object.fromEntries(entries);
```

or `new Map()` when the keys are not strings. This closes
`js/remote-property-injection` structurally rather than by dismissing it.

### 3. Keep allocator/randomness APIs in the right lane

- Unique ids: `crypto.randomUUID()`, never `Math.random()` — even when the id is
  "only" a cache or map key, because the query cannot know that.
- Temporary files: `fs.mkdtemp` + a file inside it, never a
  predictable `/tmp/<name>-<pid>-<rand>` path.
- Read-then-use: open a handle once and read from it, instead of `stat` then
  `readFile` on a path that can change in between.

### 4. Keep the quality queries at zero

`js/unused-local-variable`, `js/trivial-conditional` and
`js/useless-assignment-to-local` are cheap to keep clean and are the best early
warning that a refactor left something behind. Note two patterns that look fine
but are always findings:

- A `let x = <initial>` that every path overwrites before use. Declare without
  the initial value (`let x: Map<string, string>;`) or restructure.
- A guard that makes a later branch unreachable (`if (!canWrite) return;` …
  `canWrite ? … : …`). Delete the dead branch rather than the guard.

`js/overwritten-property` in JSON-like config objects is worth reading closely:
the **last** key wins silently, so an earlier entry can quietly do nothing. That
is how a contradictory `.eslintrc.cjs` rules block survived here.

## Alternatives to dismissal

Before dismissing, check whether the query is right about the *pattern* even
when it is wrong about the *instance*:

- **A comment that explains the invariant** is often the honest fix — but it
  does not suppress the alert.
- **A small refactor to a recognised guard** (section 1) removes the alert and
  makes the code easier to review.
- **A CodeQL model pack** can teach a query about a house helper. This is the
  correct fix if the same helper is flagged repeatedly, and is worth revisiting
  if a rule in the table above keeps returning.
