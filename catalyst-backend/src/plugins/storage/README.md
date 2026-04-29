# Plugin Storage

Catalyst supports two storage engines for plugin collections:

## Legacy Storage (Default)

Collections are stored as JSON arrays in a single `pluginStorage` row.
- **Good for:** Small collections (< 1000 docs), simple plugins
- **Cons:** O(n) queries, no DB-level indexing, slow for large collections
- **Opt-in:** No changes needed

## Dedicated Table Storage

Collections are stored as individual rows in `PluginCollectionItem`.
- **Good for:** Large collections, frequent queries, production workloads
- **Pros:** Per-row storage, DB-level pagination, concurrent-safe
- **Opt-in:** Add `"storageEngine": "dedicated"` to plugin.json

### Migration

```json
// plugin.json
{
  "name": "my-plugin",
  "storageEngine": "dedicated",
  ...
}
```

### Performance Comparison

| Metric | Legacy | Dedicated |
|--------|--------|-----------|
| Insert | ~2ms | ~5ms |
| Find (100 docs) | ~1ms | ~3ms |
| Find (10k docs) | ~200ms | ~5ms |
| Delete | O(n) | O(1) |
| Count | O(n) | ~2ms |

### When to Use Which

- **Legacy:** Quick prototyping, small config-like data, < 1000 items
- **Dedicated:** Ticketing systems, activity logs, user-generated content, > 1000 items
