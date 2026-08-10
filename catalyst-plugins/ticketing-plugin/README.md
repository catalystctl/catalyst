# Ticketing Plugin

Full-featured support ticketing for Catalyst — rewritten for the modern plugin SDK (v3).

## Features

- Ticket CRUD with status workflow validation
- Comments (public + internal) and activity log
- SLA response/resolution deadlines with auto-escalation
- Tags and ticket templates
- Bulk status/priority/delete
- CSV/JSON export
- Real-time updates over WebSocket
- Admin tab, per-server tab, and `/ticketing-plugin` user page

## Layout

```
ticketing-plugin/
├── plugin.json
├── backend/
│   ├── index.js       # lifecycle
│   ├── constants.js
│   ├── helpers.js     # domain helpers (shared with jobs)
│   ├── routes.js      # HTTP API
│   └── jobs.js        # SLA + auto-close crons
└── frontend/
    ├── index.ts       # createFrontendPlugin entry
    ├── api.ts
    ├── types.ts
    ├── constants.ts
    └── components/
```

## API (prefixed `/api/plugins/ticketing-plugin/`)

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/tickets` | List / create |
| GET/PUT/DELETE | `/tickets/:id` | Read / update / soft-delete |
| POST | `/tickets/bulk` | Bulk actions |
| GET/POST | `/tickets/:id/comments` | Comments |
| GET | `/tickets/:id/activities` | Activity log |
| GET/POST/PUT/DELETE | `/tags`, `/templates` | Meta |
| GET/PUT | `/settings` | Plugin settings |
| GET | `/stats`, `/export`, `/users`, `/servers` | Aux |

## Fixes vs v2

- Uses `request.user.userId` (host auth shape)
- SLA nested fields updated via full `$set` objects
- Cron jobs import helpers instead of broken `onLoad` closures
- Overdue filtering applied client-side (collection matcher has no dotted keys)
- Frontend co-located under `catalyst-plugins/` via SDK `createFrontendPlugin`
