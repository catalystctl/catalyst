# Contributing to Catalyst

Thank you for your interest in contributing to Catalyst! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Style & Conventions](#code-style--conventions)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors.

### Our Standards

- **Respect differing viewpoints and experiences**
- **Gracefully accept constructive criticism**
- **Focus on what is best for the community**
- **Show empathy towards other community members**

### Unacceptable Behavior

- Harassment, trolling, or discriminatory language
- Personal attacks or insulting comments
- Public or private harassment
- Publishing others' private information

### Enforcement

Project maintainers have the right to remove, edit, or reject comments, commits, code, or other contributions that do not align with this Code of Conduct.

---

## Getting Started

### First Steps

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/catalyst.git
   cd catalyst
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/original-owner/catalyst.git
   ```
4. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

### Choose Your Contribution Area

Catalyst has multiple components you can contribute to:

- **Backend (TypeScript)** - API routes, business logic, WebSocket handling
- **Frontend (React)** - UI components, pages, state management
- **Agent (Rust)** - Container operations, file management, metrics
- **Documentation** - Guides, API docs, tutorials
- **Tests** - Unit tests, integration tests, E2E tests

---

## Development Setup

### Prerequisites

- **Node.js 20+** - For backend and frontend
- **Rust 1.70+** - For agent development
- **Docker & Docker Compose** - For local development
- **PostgreSQL 14+** - Database (or use Docker)
- **Git** - Version control

### Backend Setup

```bash
cd catalyst-backend

# Install dependencies
bun install

# Copy environment file
cp .env.example .env
# Edit .env with your settings

# Initialize database
bun run db:push
bun run db:seed

# Start development server
bun run dev
```

Backend runs on **http://localhost:3000**

**Key Commands:**
```bash
bun run dev          # Start dev server with watch
bun run build        # Compile TypeScript
npm start            # Start production server
bun run lint         # Run ESLint
bun run lint -- --fix # Auto-fix linting issues
bun run db:studio    # Open Prisma Studio GUI
bun run db:migrate   # Create versioned migration
bun run db:generate  # Regenerate Prisma client
```

### Frontend Setup

```bash
cd catalyst-frontend

# Install dependencies
bun install

# Copy environment file
cp .env.example .env
# Edit .env with backend URL (http://localhost:3000)

# Start development server
bun run dev
```

Frontend runs on **http://localhost:5173**

**Key Commands:**
```bash
bun run dev          # Start dev server
bun run build        # Build production bundle
bun run preview      # Preview production build
bun run lint         # Run ESLint
bun run lint -- --fix # Auto-fix linting issues
bun run format       # Format with Prettier
bun run test         # Run Vitest tests
bun run test:e2e    # Run Playwright E2E tests
```

### Agent Setup

```bash
cd catalyst-agent

# Build for development
cargo build

# Build for production (optimized)
cargo build --release

# Run tests
cargo test

# Run linter
cargo clippy

# Format code
cargo fmt
```

### Start All Services Locally

```bash
# Start database services (PostgreSQL + Redis)
docker-compose up -d

# Start backend (terminal 1)
cd catalyst-backend && bun run dev

# Start frontend (terminal 2)
cd catalyst-frontend && bun run dev

# Optional: Start agent (terminal 3)
cd catalyst-agent && cargo run
```

---

## Code Style & Conventions

### Backend (TypeScript)

**General Rules:**
- Use **TypeScript** strictly (avoid `any`)
- Follow **functional programming** patterns where appropriate
- Use **async/await** for async operations
- Handle errors explicitly (no silent failures)

**Naming Conventions:**
- **Files:** kebab-case (`user-routes.ts`)
- **Variables/Functions:** camelCase (`getUserById`)
- **Classes/Types:** PascalCase (`UserController`, `UserProfile`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Interfaces:** PascalCase with `I` prefix (`IUser`)

**Code Structure:**
```typescript
// 1. Imports
import { z } from 'zod';
import { prisma } from '../lib/prisma';

// 2. Types/Interfaces
interface CreateUserRequest {
  email: string;
  password: string;
}

// 3. Constants
const MAX_RETRIES = 3;

// 4. Functions
export async function createUser(data: CreateUserRequest) {
  // Implementation
}

// 5. Exports
export { createUser, MAX_RETRIES };
```

**Error Handling:**
```typescript
try {
  const result = await someAsyncOperation();
  return result;
} catch (error) {
  log.error(error, 'Failed to perform operation');
  throw new InternalServerError('Operation failed');
}
```

**Validation:**
```typescript
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;
```

### Frontend (React + TypeScript)

**Component Structure:**
```typescript
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

interface ComponentProps {
  id: string;
  title?: string;
}

export function MyComponent({ id, title }: ComponentProps) {
  const [value, setValue] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['item', id],
    queryFn: () => fetchItem(id),
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading item</div>;

  return <div>{data?.name}</div>;
}
```

**Hooks:**
- Custom hooks in `src/hooks/` directory
- Prefix custom hooks with `use` (`useServers`, `useNodeHealth`)
- Return `{ data, isLoading, error, refetch }` pattern

**State Management:**
- Use **TanStack Query** for server state
- Use **Zustand** for global client state
- Keep component state local when possible

**Styling:**
- Use **Tailwind CSS** utility classes
- Use **Radix UI** for accessible components
- Keep components simple and composable

### Agent (Rust)

**General Rules:**
- Use **async/await** for async operations
- Handle errors with `Result<T, E>` where appropriate
- Use `?` operator for error propagation

**Naming Conventions:**
- **Files:** snake_case (`runtime_manager.rs`)
- **Variables/Functions:** snake_case (`get_container_status`)
- **Types/Structs:** PascalCase (`ContainerStatus`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Traits:** PascalCase (`MessageHandler`)

**Code Structure:**
```rust
// 1. Imports
use tokio::net::TcpListener;

// 2. Constants/Types
const MAX_RETRIES: u32 = 3;

struct ContainerManager {
    // Fields
}

// 3. Implementations
impl ContainerManager {
    pub async fn new() -> Result<Self, AgentError> {
        // Implementation
    }
}
```

**Error Handling:**
```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("Container not found: {0}")]
    ContainerNotFound(String),

    #[error("Runtime error: {0}")]
    RuntimeError(String),
}

pub async fn start_container(id: &str) -> Result<(), AgentError> {
    // Implementation with ? operator
}
```

---

## Testing

### Backend Tests

**Unit Tests:**
```typescript
// src/__tests__/user.test.ts
import { describe, it, expect } from 'vitest';
import { createUser } from '../services/user.service';

describe('createUser', () => {
  it('should create a user with valid data', async () => {
    const user = await createUser({
      email: 'test@example.com',
      password: 'securepassword',
    });
    expect(user).toHaveProperty('id');
    expect(user.email).toBe('test@example.com');
  });
});
```

**Run Backend Tests:**
```bash
cd catalyst-backend
bun run test
```

### Frontend Tests

**Component Tests:**
```typescript
// src/components/__tests__/Button.test.tsx
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

describe('Button', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });
});
```

**Run Frontend Tests:**
```bash
cd catalyst-frontend
bun run test
```

### Agent Tests

**Unit Tests:**
```rust
// src/runtime_manager.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_container() {
        let manager = ContainerManager::new().await.unwrap();
        let result = manager.create_container("test").await;
        assert!(result.is_ok());
    }
}
```

**Run Agent Tests:**
```bash
cd catalyst-agent
cargo test
```

### E2E Tests

Catalyst uses bash scripts for comprehensive E2E testing.

**Run All E2E Tests:**
```bash
cd tests
./run-all-tests.sh
```

**Run Specific Test Suite:**
```bash
cd tests
./01-auth.test.sh
./04-servers.test.sh
```

**Quick Smoke Tests:**
```bash
# From project root
./test-backend.sh              # API smoke test
./test-api-integration.sh      # Extended API tests
```

---

## Submitting Changes

### Before Submitting

1. **Run linters:**
   ```bash
   # Backend
   cd catalyst-backend && bun run lint -- --fix

   # Frontend
   cd catalyst-frontend && bun run lint -- --fix && bun run format

   # Agent
   cd catalyst-agent && cargo fmt && cargo clippy
   ```

2. **Run tests:**
   ```bash
   cd catalyst-backend && npm test
   cd catalyst-frontend && npm test
   cd catalyst-agent && cargo test
   ```

3. **Test manually:**
   - Verify your changes work as expected
   - Test edge cases
   - Check for regressions

4. **Update documentation:**
   - Update README if needed
   - Update API docs for new endpoints
   - Add comments for complex logic

### Commit Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting)
- `refactor` - Code refactoring
- `perf` - Performance improvements
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

**Examples:**
```
feat(backend): add server transfer API

Implements server-to-node transfer with automatic backup
creation and rollback on failure.

Closes #123
```

```
fix(frontend): resolve console WebSocket reconnection issue

Fixed race condition in WebSocket store that prevented
reconnection after network failure.
```

### Pull Request Process

1. **Update your branch:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push to your fork:**
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create Pull Request:**
   - Go to GitHub and create PR
   - Fill in PR template
   - Link related issues
   - Add screenshots for UI changes

4. **Respond to review feedback:**
   - Address all review comments
   - Update PR as needed
   - Request re-review when done

### PR Checklist

- [ ] Code follows project conventions
- [ ] Linters pass without warnings
- [ ] Tests pass (unit + integration + E2E)
- [ ] Documentation updated
- [ ] Commit messages follow conventional commits
- [ ] PR description clearly explains changes
- [ ] Related issues linked

---

## Reporting Bugs

### Before Reporting

1. **Search existing issues** - Check if bug is already reported
2. **Check documentation** - Ensure it's not a configuration issue
3. **Test on latest version** - Verify bug still exists

### Bug Report Template

```markdown
**Description:**
A clear and concise description of what the bug is.

**To Reproduce:**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

**Expected Behavior:**
A clear description of what you expected to happen.

**Actual Behavior:**
What actually happened.

**Screenshots:**
If applicable, add screenshots to help explain the problem.

**Environment:**
- OS: [e.g. Ubuntu 22.04]
- Node.js: [e.g. 20.10.0]
- Rust: [e.g. 1.70.0]
- Catalyst Version: [e.g. 1.0.0]

**Logs:**
Relevant log output:

```
Paste logs here
```

**Additional Context:**
Any other context about the problem.
```

---

## Feature Requests

### Before Requesting

1. **Search existing issues** - Check if feature is already requested
2. **Check roadmap** - See if feature is planned
3. **Consider impact** - Will this benefit many users?

### Feature Request Template

```markdown
**Is your feature request related to a problem?**
A clear and concise description of what the problem is.

**Describe the solution you'd like:**
A clear description of what you want to happen.

**Describe alternatives you've considered:**
A clear description of any alternative solutions or features you've considered.

**Additional context:**
Any other context, screenshots, or examples about the feature request here.
```

---

## Development Guidelines

### Backend Development

**Adding API Endpoints:**

1. Define request/response schemas with Zod
2. Add route handler in `src/routes/`
3. Add RBAC middleware for protected routes
4. Write unit tests
5. Update API documentation

**Example:**
```typescript
// src/routes/servers.ts
const StartServerSchema = z.object({
  serverId: z.string(),
});

app.post('/api/servers/:id/start',
  { onRequest: rbac.checkPermission('server.start') },
  async (request, reply) => {
    const { serverId } = StartServerSchema.parse(request.params);
    // Implementation
  }
);
```

**Database Changes:**

1. Update `prisma/schema.prisma`
2. Run `bun run db:migrate`
3. Regenerate client: `bun run db:generate`
4. Update affected services

### Frontend Development

**Adding Pages:**

1. Create page component in `src/pages/`
2. Add route in `src/App.tsx`
3. Create data fetching hooks in `src/hooks/`
4. Write component tests

**Example:**
```typescript
// src/pages/ServersPage.tsx
import { useServers } from '../hooks/useServers';

export function ServersPage() {
  const { data: servers, isLoading } = useServers();

  if (isLoading) return <div>Loading...</div>;
  return <ServerList servers={servers} />;
}
```

### Agent Development

**Adding Message Handlers:**

1. Define message type in WebSocket protocol
2. Add handler in `websocket_handler.rs`
3. Implement logic in appropriate service
4. Write tests

**Example:**
```rust
// src/websocket_handler.rs
async fn handle_backup_request(&self, msg: BackupRequest) -> Result<(), AgentError> {
    self.runtime_manager.create_backup(&msg.server_id).await?;
    self.send_message(BackupSuccess { server_id: msg.server_id }).await?;
    Ok(())
}
```

---

## Documentation Contributions

We welcome documentation improvements! Areas that need help:

- **Getting Started Guide** - Improve setup instructions
- **API Documentation** - Add examples and clarify endpoints
- **Tutorials** - Write guides for common tasks
- **Architecture Docs** - Explain design decisions
- **Translation** - Translate documentation to other languages

### Documentation Style

- Use **clear, simple language**
- Include **code examples** where helpful
- Add **screenshots** for UI-related docs
- Keep **examples up-to-date**
- Use **consistent formatting**

---

## Getting Help

### Resources

- **Documentation:** [docs/](docs/)
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Features:** [docs/FEATURES.md](docs/FEATURES.md)
- **API Reference:** [docs/README.md](docs/README.md)

### Community

- **GitHub Issues:** Report bugs, request features
- **Discord:** Real-time chat with community
- **Email:** support@catalyst.dev (enterprise support)

### Good First Issues

Look for issues labeled `good first issue` if you're new to the project.

---

## License

By contributing to Catalyst, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Catalyst! 🎉**
