# Catalyst MCP server

An MCP server that lets an AI assistant manage your Catalyst game-server panel: servers, power actions, files, console, backups, databases, schedules, nodes, locations, templates, users, roles, API keys, and alerts.

It talks to the panel over HTTPS with a `catalyst_...` API key. Configure it once with the panel URL and key; every tool call reuses that configuration.

## Requirements

- Node.js 20 or newer
- A Catalyst panel (self-hosted) reachable over HTTP(S)
- A panel API key from **Profile > API keys** with the permissions you want the assistant to have

## Install

```bash
pnpm install
pnpm --filter @catalyst/mcp-server run build
```

## Configure

Set these environment variables wherever your MCP client launches the server:

| Variable | Required | Example |
|----------|----------|---------|
| `CATALYST_URL` | Yes | `https://panel.example.com` |
| `CATALYST_API_KEY` | Yes | `catalyst_...` |

Aliases: `CATALYST_PANEL_URL` / `CATALYST_BASE_URL` work for the URL, `CATALYST_TOKEN` works for the key. A trailing `/api` on the URL is accepted.

The key can only do what its permissions allow. For full access, create it with **All permissions** (it inherits your live permissions). For safer automation, scope it, for example to `server.read`, `server.start`, `server.stop`, and `file.read`.

## Use with Claude Code / Claude Desktop

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "catalyst": {
      "command": "node",
      "args": ["/home/karutoil/catalyst/packages/mcp-server/dist/index.js"],
      "env": {
        "CATALYST_URL": "https://panel.example.com",
        "CATALYST_API_KEY": "catalyst_..."
      }
    }
  }
}
```

Or run from source during development:

```json
{
  "mcpServers": {
    "catalyst": {
      "command": "pnpm",
      "args": ["--filter", "@catalyst/mcp-server", "run", "dev"],
      "env": {
        "CATALYST_URL": "https://panel.example.com",
        "CATALYST_API_KEY": "catalyst_..."
      }
    }
  }
}
```

## Tools (174)

Meta: `panel_health`, `whoami`, `get_dashboard_stats`, `get_recent_activity`, `list_permissions_catalog`, `get_my_permissions`.

Servers: `list_servers`, `get_server`, `create_server`, `update_server`, `delete_server`, `clone_server`, `resize_server_disk`, `start_server`, `stop_server`, `restart_server`, `kill_server`, `install_server`, `reinstall_server`, `cancel_install`, `rebuild_server`, `suspend_server`, `unsuspend_server`, `respond_to_eula`, `send_console_command`, `get_server_logs`, `get_server_variables`, `update_server_variables`, `get_server_stats`, `get_server_metrics_history`.

Sharing: `list_server_invites`, `create_server_invite`, `delete_server_invite`, `regenerate_server_invite`, `preview_invite`, `list_server_access`, `grant_server_access`, `remove_server_access`, `get_my_server_permissions`, `list_transfer_candidates`, `transfer_server_ownership`.

Files: `list_files`, `download_file`, `write_file`, `create_file_or_directory`, `rename_file`, `delete_file`, `set_file_permissions`, `compress_files`, `decompress_archive`, `list_archive_contents`.

Network: `list_server_allocations`, `add_server_allocation`, `remove_server_allocation`.

Databases: `list_database_hosts`, `list_server_databases`, `create_server_database`, `delete_server_database`.

Backups: `list_backups`, `create_backup`, `restore_backup`, `delete_backup`, `get_backup_download`.

Schedules: `list_scheduled_tasks`, `create_scheduled_task`, `update_scheduled_task`, `delete_scheduled_task`, `get_scheduled_task`, `execute_scheduled_task`.

Bulk: `bulk_suspend_servers`, `bulk_unsuspend_servers`, `bulk_delete_servers`.

Mods and plugins: `search_mods`, `install_mod`, `list_installed_mods`, `uninstall_mod`, `check_mod_updates`, `search_plugins`, `install_plugin`, `list_installed_plugins`, `uninstall_plugin`.

SFTP: `list_sftp_tokens`.

Nodes: `list_nodes`, `get_node`, `create_node`, `update_node`, `delete_node`, `list_node_allocations`, `create_node_allocation`, `delete_node_allocation`, `get_node_stats`, `get_node_metrics_history`, `list_node_assignments`, `assign_node`, `remove_node_assignment`.

Locations: `list_locations`, `get_location`, `create_location`, `update_location`, `delete_location`.

Templates: `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `import_pterodactyl_egg`, `list_nests`, `get_nest`, `create_nest`, `update_nest`, `delete_nest`.

Users: `list_users`, `get_user`, `create_user`, `update_user`, `delete_user`, `ban_user`, `unban_user`, `list_user_servers`.

Roles and keys: `list_roles`, `get_role`, `create_role`, `update_role`, `delete_role`, `assign_role_to_user`, `remove_role_from_user`, `list_role_presets`, `get_user_roles`, `add_role_permission`, `remove_role_permission`, `set_role_scope`, `list_role_nodes`, `get_user_nodes`, `list_api_keys`, `create_api_key`, `get_api_key`, `update_api_key`, `delete_api_key`, `get_api_key_usage`.

Alerts: `list_alert_rules`, `create_alert_rule`, `get_alert_rule`, `update_alert_rule`, `delete_alert_rule`, `list_alerts`, `list_alert_deliveries`, `resolve_alert`, `bulk_resolve_alerts`, `get_alert_stats`.

Audit and errors: `list_audit_logs`, `list_system_errors`, `resolve_system_error`, `resolve_all_system_errors`.

Database hosts: `list_db_hosts`, `create_db_host`, `update_db_host`, `delete_db_host`, `ping_db_host`.

Panel plugins: `list_panel_plugins`, `get_panel_plugin`, `set_panel_plugin_enabled`, `reload_panel_plugin`, `install_panel_plugin`, `browse_plugin_marketplace`.

Migration: `list_migration_jobs`, `get_migration_job`, `get_migration_steps`, `pause_migration_job`, `resume_migration_job`, `cancel_migration_job`, `retry_migration_step`.

System: `get_update_status`, `trigger_panel_update`, `get_provider_key_status`.

## Security notes

- The API key is sent as `Authorization: Bearer catalyst_...` over HTTPS. Keep it out of prompts and logs.
- Destructive tools (`reinstall_server`, `delete_server`, `restore_backup`, `delete_user`, `ban_user`) run immediately when called. Pair them with a least-privilege key when the assistant only needs read or power actions.
- `panel_health` is the only unauthenticated probe; everything else requires the key.
