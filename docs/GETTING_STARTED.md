# Getting Started with Catalyst

Complete guide to setting up Catalyst for different use cases.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Production Deployment](#production-deployment)
- [API Integration](#api-integration)
- [Troubleshooting](#troubleshooting)
- [Next Steps](#next-steps)

---

## Prerequisites

### For Local Development

- **Docker & Docker Compose** - For PostgreSQL and Redis
- **Node.js 20+** - For backend and frontend
- **npm or yarn** - Package manager
- **Git** - For cloning repository

### For Production Deployment

- **Linux server** (Ubuntu 22.04+ or Debian 12+ recommended)
- **PostgreSQL 14+** - Database
- **Node.js 20+** - Backend runtime
- **Rust 1.70+** - Agent compilation (if building from source)
- **containerd** - Container runtime (agent auto-installs if missing)
- **SSL certificate** - For production TLS

### For API Integration

- **API key** - Generated from Catalyst admin panel
- **HTTP client** - curl, Postman, or programming language
- **Network access** - To Catalyst backend API

---

## Local Development Setup

### Step 1: Clone and Prepare

```bash
git clone https://github.com/your-repo/catalyst.git
cd catalyst
```

### Step 2: Start Database Services

```bash
docker-compose up -d
```

This starts:
- **PostgreSQL** on port 5432
- **Redis** on port 6379

Verify services:
```bash
docker ps
```

### Step 3: Backend Setup

```bash
cd catalyst-backend

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Initialize database
bun run db:push
bun run db:seed

# Start development server
bun run dev
```

Backend will start on **http://localhost:3000**

### Step 4: Frontend Setup

Open a new terminal:

```bash
cd catalyst-frontend

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with API URL (usually http://localhost:3000)

# Start development server
bun run dev
```

Frontend will start on **http://localhost:5173**

### Step 5: Access the Panel

1. Open **http://localhost:5173** in your browser
2. Register or login with default credentials (see `.env` or seed data)
3. Create your first node and server!

### Development Commands

**Backend:**
```bash
bun run dev          # Start dev server with watch mode
bun run build        # Compile TypeScript
npm start            # Start production server
bun run lint         # Run ESLint
bun run db:studio    # Open Prisma Studio GUI
```

**Frontend:**
```bash
bun run dev          # Start dev server
bun run build        # Build production bundle
bun run preview      # Preview production build
bun run lint         # Run ESLint
bun run test         # Run Vitest tests
```

**Testing:**
```bash
./test-backend.sh              # Quick API smoke test
./test-api-integration.sh      # Extended API tests
cd tests && ./run-all-tests.sh # Full E2E suite
```

---

## Production Deployment

### Step 1: Prepare Backend Server

```bash
# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repository
git clone https://github.com/your-repo/catalyst.git
cd catalyst/catalyst-backend

# Install production dependencies
bun install --frozen-lockfile --only=production
```

### Step 2: Configure PostgreSQL

```bash
# Install PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql
```

```sql
CREATE DATABASE catalyst_prod;
CREATE USER catalyst_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE catalyst_prod TO catalyst_user;
\q
```

### Step 3: Configure Backend

```bash
cp .env.example .env
nano .env
```

**Key settings to update:**
```env
DATABASE_URL="postgresql://catalyst_user:secure_password@localhost/catalyst_prod"
PORT=3000
CORS_ORIGIN="https://your-frontend-domain.com"
BACKEND_EXTERNAL_ADDRESS="https://your-backend-domain.com"
FRONTEND_URL="https://your-frontend-domain.com"
JWT_SECRET="your-super-secret-jwt-key-32-chars-min"
BETTER_AUTH_SECRET="your-super-secret-auth-key-32-chars-min"
NODE_ENV=production
```

### Step 4: Initialize Database

```bash
bun run db:push
bun run db:seed
```

### Step 5: Build and Start Backend

```bash
# Build for production
bun run build

# Start with PM2 (recommended)
bun install -g pm2
pm2 start dist/index.js --name catalyst-backend
pm2 save
pm2 startup
```

Or use systemd:
```bash
sudo nano /etc/systemd/system/catalyst-backend.service
```

```ini
[Unit]
Description=Catalyst Backend
After=network.target

[Service]
Type=simple
User=catalyst
WorkingDirectory=/opt/catalyst/catalyst-backend
ExecStart=/usr/bin/node dist/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable catalyst-backend
sudo systemctl start catalyst-backend
```

### Step 6: Setup Reverse Proxy (Nginx)

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

```nginx
server {
    listen 80;
    server_name your-backend-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable SSL:
```bash
sudo certbot --nginx -d your-backend-domain.com
```

### Step 7: Deploy Node Agent

On each game server node:

```bash
# Copy agent binary
scp catalyst-agent/target/release/catalyst-agent user@node:/usr/local/bin/

# SSH to node
ssh user@node

# Run agent (auto-configures dependencies)
sudo /usr/local/bin/catalyst-agent
```

On first run, agent will:
- ✅ Detect system and install containerd/nerdctl
- ✅ Configure CNI networking (macvlan)
- ✅ Connect to backend via WebSocket

Configure agent via `/opt/catalyst-agent/config.toml`:
```toml
backend_ws_url = "wss://your-backend-domain.com/ws"
node_id = "your-node-id"
node_secret = "your-node-secret"
```

### Step 8: Deploy Frontend (Optional)

If hosting frontend separately:

```bash
cd catalyst-frontend
bun install --frozen-lockfile
bun run build
```

Copy `dist/` to your web server and configure Nginx to serve it.

---

## API Integration

### Step 1: Create API Key

Login to Catalyst admin panel → **Admin → API Keys → Create**

Or create via API:

```bash
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: your-admin-session" \
  -d '{
    "name": "Billing Integration",
    "rateLimitEnabled": true,
    "rateLimitMax": 1000,
    "rateLimitTimeWindow": 60000
  }' | jq -r '.data.key'
```

**Save the key!** It's only shown once.

### Step 2: Use API Key

All API requests use the `x-api-key` header:

```bash
export API_KEY="catalyst_xxx_yyy_zzz"

# List all servers
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/servers

# Create a server
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Customer Server",
    "templateId": "template-id",
    "nodeId": "node-id",
    "ownerId": "user-id",
    "allocatedMemoryMb": 4096
  }'
```

### Step 3: Common Automation Tasks

**Provision server on order:**
```javascript
const response = await fetch('http://localhost:3000/api/servers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY
  },
  body: JSON.stringify({
    name: customerName + ' Server',
    templateId: gameTemplate,
    nodeId: optimalNode,
    ownerId: customerId,
    allocatedMemoryMb: package.memory
  })
});
const server = await response.json();
```

**Suspend for non-payment:**
```javascript
await fetch(`http://localhost:3000/api/servers/${serverId}/suspend`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY
  },
  body: JSON.stringify({
    reason: 'Payment overdue - Invoice #' + invoiceId,
    stopServer: true
  })
});
```

👉 [Complete API guide](docs/README.md)

👉 [Billing integration examples](docs/automation-api-guide.md)

---

## Troubleshooting

### Backend Won't Start

**Problem:** `EADDRINUSE` error
```bash
# Check what's using port 3000
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>
```

**Problem:** Database connection failed
```bash
# Verify PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -U catalyst_user -d catalyst_prod -h localhost

# Check DATABASE_URL in .env
```

### Frontend Won't Connect to Backend

**Problem:** CORS errors
- Check `CORS_ORIGIN` in backend `.env` matches frontend URL
- Ensure frontend `VITE_API_URL` points to correct backend address

**Problem:** WebSocket connection failed
- Check WebSocket URL in `VITE_WS_URL`
- Verify backend WebSocket gateway is running
- Check firewall rules for WebSocket port

### Agent Won't Connect

**Problem:** Agent can't reach backend
```bash
# Test WebSocket connection from node
curl -I https://your-backend-domain.com/ws

# Check firewall allows outbound connections
sudo ufw status
```

**Problem:** containerd not installed
```bash
# Agent auto-installs on first run
# Or install manually:
sudo apt-get install -y containerd

# Verify
sudo nerdctl version
```

### Database Issues

**Problem:** Migration failed
```bash
# Reset database (CAUTION: deletes all data!)
bun run db:push -- --force-reset
bun run db:seed
```

**Problem:** Prisma client outdated
```bash
bun run db:generate
```

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `ECONNREFUSED` | Service not running | Start backend/database |
| `Unauthorized` | Invalid credentials | Check API key/JWT token |
| `Rate limit exceeded` | Too many requests | Wait or increase rate limit |
| `Permission denied` | Missing RBAC permission | Grant permission to user |
| `Container not found` | Server not installed | Start server first |

---

## Next Steps

### For Server Hosts

1. **Deploy to production** - Follow the production deployment guide
2. **Configure nodes** - Add multiple nodes for scalability
3. **Set up backups** - Configure backup storage (local or S3)
4. **Configure alerts** - Set up monitoring and notifications
5. **Review security** - Enable TLS, rotate secrets, audit permissions

👉 [Admin Guide](docs/ADMIN_GUIDE.md)

### For Game Communities

1. **Deploy locally** - Try the quick start to explore features
2. **Create templates** - Set up game server templates
3. **Invite collaborators** - Share server access with team
4. **Automate tasks** - Schedule backups and restarts

👉 [User Guide](docs/USER_GUIDE.md)

### For Developers

1. **Explore the API** - Check out the complete API reference
2. **Build a plugin** - Extend Catalyst with custom functionality
3. **Integrate billing** - Automate server provisioning

👉 [API Reference](docs/README.md)

👉 [Plugin System](docs/PLUGIN_SYSTEM.md)

---

## Additional Resources

- **[Architecture Overview](docs/ARCHITECTURE.md)** - Deep dive into system design
- **[Features List](docs/FEATURES.md)** - Complete feature catalog
- **[Security Guide](docs/SECURITY.md)** - Security best practices
- **[Testing Guide](tests/README.md)** - Running and writing tests
- **[AGENTS.md](AGENTS.md)** - Repository conventions and guidelines

---

## Getting Help

- 📖 **Documentation** - [docs/](docs/)
- 🐛 **Issues** - [GitHub Issues](https://github.com/your-repo/issues)
- 💬 **Community** - [Discord](https://discord.gg/your-server)
- 📧 **Support** - [support@catalyst.dev](mailto:support@catalyst.dev)

---

**Ready to get started?** Choose your path above and deploy Catalyst today! 🚀
