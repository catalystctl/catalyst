# Prisma Streams Local Build

This directory contains the generated Node-compatible package artifacts for the
published `@prisma/streams-local` runtime.

## What Local Streams Is

Prisma Streams local is a trusted-development Durable Streams server intended
for embedded workflows such as `prisma dev`.

It keeps all state in a single local SQLite database and supports the live /
touch system, but it does not run the full production segmenting and object
store pipeline.

## Supported Package Surface

- `@prisma/streams-local`
- `@prisma/streams-local/internal/daemon` (internal Prisma CLI plumbing)

The full self-hosted server remains Bun-only and is not part of this Node build
surface.

## Integrating It

1. Start a named local server from `@prisma/streams-local`.
2. Install your touch-enabled interpreter via `/_schema`.
3. Feed normalized State Protocol change events into the server.
4. Use `/touch/meta` and `/touch/wait` to drive invalidation.

Programmatic example:

```ts
import { startLocalDurableStreamsServer } from "@prisma/streams-local";

const server = await startLocalDurableStreamsServer({
  name: "default",
  hostname: "127.0.0.1",
  port: 0,
});

console.log(server.exports.http.url);
console.log(server.exports.sqlite.path);

await server.close();
```

Daemon example:

```ts
import { fork } from "node:child_process";

const child = fork(require.resolve("@prisma/streams-local/internal/daemon"), [
  "--name",
  "default",
  "--port",
  "0",
], {
  stdio: "inherit",
});
```

See ../docs/overview.md and ../docs/local-dev.md for the full runtime and release
documentation.
