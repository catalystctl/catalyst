# @catalyst/plugin-sdk

Official SDK for building Catalyst plugins.

## Installation

```bash
npm install @catalyst/plugin-sdk
```

## Quick Start

```typescript
import { defineRoutes } from '@catalyst/plugin-sdk';

export default {
  async onLoad(context) {
    const routes = defineRoutes((router) => {
      router.get('/hello', async (req, reply) => {
        return { message: 'Hello!' };
      });
    });

    for (const route of routes) {
      context.registerRoute(route);
    }
  },
};
```

## CLI

```bash
npx @catalyst/plugin-sdk create my-plugin --template fullstack
```

## Testing

```typescript
import { createTestPlugin } from '@catalyst/plugin-sdk/testing';

const harness = createTestPlugin(myPlugin, manifest, config);
const context = await harness.load();
```
