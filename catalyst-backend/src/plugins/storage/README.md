# Plugin storage

Plugin collections have two backing engines, chosen per plugin in `plugin.json`.
Both expose the same `PluginCollectionAPI` (`find`, `findOne`, `insert`,
`update`, `delete`, `count`) with Mongo-style filters, so switching engines needs
no code change.

## Legacy (default)

The whole collection is one JSON array in a single `PluginStorage` row
(`pluginName` + `key`). Every operation loads and re-saves that array.

- Opt in: nothing — this is the default when `storageEngine` is absent.
- Use for: small config-like collections, prototypes.
- Cost: reads/writes scale with the number of documents in the collection.

## Dedicated (`storageEngine: "dedicated"`)

Each document is a row in `PluginCollectionItem` (`pluginName`, `collectionName`,
`docId`, `document`), with a unique index on `(pluginName, collectionName,
docId)` and an index on `(pluginName, collectionName)`. Implemented in
`collection-storage.ts`.

```json
// plugin.json
{
  "name": "my-plugin",
  "storageEngine": "dedicated"
}
```

- Use for: anything users create rows in — tickets, activity logs, user content.
- Gives per-row storage, DB-level pagination and per-document writes instead of
  rewriting one array.

Filters and update operators behave identically on both engines
(`src/plugins/path-utils.ts`): dotted paths (`sla.resolutionBreached`) and
`$set`, `$unset`, `$inc`, `$push`, `$pull`.
