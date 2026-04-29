# Catalyst Plugin System — Comprehensive Review

This directory contains a thorough analysis of the Catalyst plugin (extension) system, conducted using a chain of specialized analysis agents.

## Reports

| File | Lines | Description |
|------|-------|-------------|
| `01-architecture-analysis.md` | 825 | Deep architectural analysis of every interface, class, function, and data flow across the entire plugin stack (backend + frontend + examples) |
| `02-gap-analysis.md` | 484 | 40+ gaps identified across 13 dimensions (isolation, DX, security, performance, frontend, distribution, testing, observability, lifecycle, RPC, code quality, storage) with severity ratings |
| `03-improvement-report.md` | 1,866 | Concrete redesign recommendations with code examples, phased implementation roadmap, and risk assessment |

## Executive Summary

### Recommendation: Incremental Rewrite with Phased Migration

A full ground-up rewrite would discard working code. Instead, introduce a **new plugin runtime alongside** the existing system, allowing gradual migration. Existing plugins (ticketing, egg-explorer, example-plugin) continue running while new plugins target the improved runtime.

### Critical Gaps Found (5)

1. **No process isolation** — plugins run in the same Node.js process; a memory leak or infinite loop crashes the entire Catalyst server
2. **Collection storage is O(n) JSON arrays** — entire collections loaded into memory for every query
3. **No dynamic frontend loading** — plugins must be bundled at build time; no runtime installation
4. **Field whitelist bypass vulnerability** — `args?.select` spread allows plugins to override safe field lists
5. **No audit trail for plugin actions** — successful plugin DB operations are not logged

### High-Severity Gaps Found (17)

- **Security**: No row-level security, weak config validation, auth middleware can be bypassed
- **DX**: No SDK, no scaffolding CLI, no testing utilities, no typed helpers
- **Performance**: Sequential plugin loading blocks startup, no request timeouts, no resource limits
- **Frontend**: No error boundaries (plugin crashes bring down React app), no CSS isolation
- **Distribution**: No registry beyond filesystem, no npm integration, no signing
- **Reliability**: No debounced hot-reload (race conditions), no formal state machine
- **Observability**: No per-plugin metrics, no health checks, no crash reporting

### Key Redesign Recommendations

#### A. Plugin Isolation Model
Introduce a **dual-runtime architecture**: legacy in-process runtime + new isolated runtime using `worker_threads` with memory limits (128MB default), request timeouts (5s), and CPU throttling.

#### B. Plugin SDK (`@catalyst/plugin-sdk`)
Publish a typed SDK with generic `createTypedContext<TConfig, TEvents>()`, `createMockContext()` for testing, and a CLI scaffolding tool.

#### C. Security Enhancements
- Fix field whitelist bypass by merging `select` instead of spreading
- Add row-level security hooks
- Add plugin action audit trail
- Replace `z.any()` config with discriminated union schema
- Always enforce auth middleware (plugins cannot bypass)

#### D. Performance & Scalability
- Replace JSON-array collections with dedicated `PluginDocument` table + indexing
- Parallel plugin loading grouped by dependency depth
- Add `NodeCache` layer for plugin data

#### E. Plugin Distribution
- npm-based installation: `catalyst-cli plugin install @catalyst-plugins/ticketing`
- Plugin signing with SHA256 + public key verification
- Marketplace API for curated plugin discovery

#### F. Frontend Architecture
- `PluginErrorBoundary` per plugin — isolated crashes
- CSS isolation via `data-catalyst-plugin` attribute
- Module Federation research for true runtime loading (Phase 3)

#### G. Observability
- Per-plugin Prometheus metrics (request duration, error rate)
- Health check registration API
- Admin dashboard endpoints for plugin metrics and logs

#### H. Lifecycle & State Management
- Replace status enum with formal `PluginStateMachine` (11 states, transition locking)
- Debounced hot-reload (500ms)
- Graceful degradation: failed plugins auto-retry, not crash

### Implementation Roadmap

| Phase | Duration | Focus | Risk |
|-------|----------|-------|------|
| **Phase 1** | ~2 weeks | Fix field whitelist, add error boundaries, debounce hot-reload, enforce auth, add metrics | Low — no breaking changes |
| **Phase 2** | ~1-2 months | Build SDK, isolated runtime, ScalableCollection, npm install, config validation | Medium — manifest schema changes |
| **Phase 3** | ~3+ months | Marketplace UI, plugin signing, Module Federation, CI/CD pipeline | Medium — new infrastructure |

### Migration Effort for Existing Plugins

- Example Plugin: 2-4 hours
- Ticketing Plugin: 1-2 days (heavy collection usage)
- Egg Explorer: 2-4 hours
