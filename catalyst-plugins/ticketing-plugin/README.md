# Ticketing Plugin

A full-featured ticketing system for the Catalyst panel. Ships disabled by default and can be enabled via **Admin → Plugins → Ticketing System → Enable**.

## Features

### Ticket Management
- **Create, read, update, delete** tickets with rich metadata
- **Subject & description** with character limits
- **Unique ticket IDs** (e.g., `TKT-M1X2K3-ABCD`)
- **Auto-incrementing ticket numbers**

### Linking
- **Link to servers** — associate tickets with specific game servers
- **Link to users** — associate tickets with user accounts
- Server/user info auto-enriched from the database

### Organization
- **6 default categories**: General, Billing, Technical Support, Server Issues, Feature Request, Bug Report
- **4 priority levels**: Critical, High, Medium, Low
- **Tags** — add custom tags to any ticket
- **Custom fields** via plugin settings

### Status Workflow
```
Open → In Progress → Pending → Resolved → Closed
  ↑___________|    ↑___|            ↑___|
```
- Enforced state transitions prevent invalid status changes
- Status change available inline and via comments

### Comments
- Add public comments and **internal-only notes**
- Edit and delete comments
- **Status change with comment** — change ticket status while replying
- Closed tickets cannot receive new comments
- User info auto-enriched on comments

### Assignment
- Assign tickets to any panel user
- Assign/unassign from ticket detail view
- **Unassigned tickets** highlighted on dashboard

### Filtering & Search
- Filter by **status**, **priority**, **category**
- **Full-text search** across ticket ID, subject, and description
- Sort by **newest**, **oldest**, **recently updated**, **priority**
- **Pagination** (25 per page)

### Dashboard
- **Summary cards**: total, open, in progress, pending, resolved, closed
- **Attention panel**: unassigned, critical, and high-priority tickets
- **Metrics**: average resolution time, average first response time, tickets in last 30 days
- **Category breakdown** with visual progress bars
- **Priority breakdown**
- **Recent activity** feed
- Click any dashboard element to filter the ticket list

### Bulk Operations
- Bulk update status, priority, assignment, and category
- Up to 100 tickets at once

### Notifications
- **WebSocket events** for real-time updates:
  - `ticketing:ticket:created`
  - `ticketing:ticket:updated`
  - `ticketing:ticket:deleted`
  - `ticketing:ticket:comment-added`
  - `ticketing:ticket:comment-deleted`
  - `ticketing:ticket:status-changed`
  - `ticketing:ticket:assigned`
  - `ticketing:ticket:bulk-updated`
  - `ticketing:ticket:auto-closed`

### Automation
- **Auto-close** resolved tickets after a configurable number of days (default: 30)
- Runs daily at midnight via cron
- Configurable via plugin settings

### Export
- Export all tickets with filters (by status, category, server)
- Includes all comments in export

## Configuration

| Setting | Type | Default | Description |
|---|---|---|---|
| `autoCloseDays` | number | 30 | Days after which resolved tickets auto-close (0 = disabled) |
| `maxOpenTicketsPerUser` | number | 20 | Max open tickets per user (0 = unlimited) |
| `defaultPriority` | string | medium | Default priority for new tickets |
| `allowedPriorities` | string | low,medium,high,critical | Comma-separated allowed priorities |
| `notifyOnAssignment` | boolean | true | WebSocket notification on assignment |
| `notifyOnComment` | boolean | true | WebSocket notification on new comments |
| `notifyOnStatusChange` | boolean | true | WebSocket notification on status changes |

## API Endpoints

All endpoints are namespaced under `/api/plugins/ticketing-plugin/`

### Tickets
| Method | Path | Description |
|---|---|---|
| GET | `/tickets` | List tickets (filters, search, pagination) |
| GET | `/tickets/:id` | Get ticket with comments |
| POST | `/tickets` | Create a new ticket |
| PUT | `/tickets/:id` | Update ticket (status, priority, assignment, etc.) |
| DELETE | `/tickets/:id` | Delete a ticket |
| POST | `/tickets/bulk` | Bulk update tickets |

### Comments
| Method | Path | Description |
|---|---|---|
| GET | `/tickets/:id/comments` | List comments for a ticket |
| POST | `/tickets/:id/comments` | Add a comment (with optional status change) |
| PUT | `/tickets/:id/comments/:commentId` | Edit a comment |
| DELETE | `/tickets/:id/comments/:commentId` | Delete a comment |

### Categories
| Method | Path | Description |
|---|---|---|
| GET | `/categories` | List all categories |
| POST | `/categories` | Create a category |
| PUT | `/categories/:id` | Update a category |
| DELETE | `/categories/:id` | Delete a category |

### Meta
| Method | Path | Description |
|---|---|---|
| GET | `/statuses` | List available statuses |
| GET | `/transitions` | List valid status transitions |
| GET | `/users` | List users for assignment dropdown |
| GET | `/servers` | List servers for linking dropdown |
| GET | `/stats` | Dashboard statistics |
| GET | `/settings` | Get plugin settings |
| PUT | `/settings` | Update plugin settings |
| GET | `/export` | Export tickets (with optional filters) |

## Frontend Tabs

### Admin Tab (`/admin/plugin/ticketing-admin`)
- Full ticket management dashboard
- Create, view, update, delete tickets
- Filtering, search, sorting, pagination
- Dashboard with statistics and metrics

### Server Tab (`/servers/:id/plugin/ticketing-server`)
- Tickets linked to a specific server
- Create tickets pre-linked to the server
- Filter by status

## Storage

All data is persisted via the Catalyst PluginStorage API. No database migrations required — data lives in the `PluginStorage` table scoped to `ticketing-plugin`.
