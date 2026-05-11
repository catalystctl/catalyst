# 🚀 Quick Start — Get Catalyst Running in 5 Minutes

Welcome! This is the fastest way to get Catalyst up and running. If you want the full detailed guide, see [Installation](installation.md). If you already have the panel running, jump to [Getting Started](getting-started.md) to create your first server.

---

## Prerequisites

- **Docker** with Compose support (or **Podman** — same commands, just swap `docker` for `podman`)
- That's it! Everything runs in containers.

---

## Step 1: Run the One-Line Installer

```bash
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
```

**What this does:**
- Downloads the standalone `catalyst-docker/` folder
- Copies `.env.example` → `.env`
- Generates strong secrets automatically

---

## Step 2: Configure `.env`

```bash
cd catalyst-docker
nano .env
```

Set **these 3 required variables**:

| Variable | What it is | Example |
|----------|-----------|---------|
| `PUBLIC_URL` | The URL you will visit in your browser | `http://localhost:8080` |
| `POSTGRES_PASSWORD` | A strong password for the database | `my-super-secret-db-pass` |
| `BETTER_AUTH_SECRET` | A random 32-byte key for session encryption | *(generate below)* |

**Generate secrets:**

```bash
# Generate a strong auth secret
openssl rand -base64 32
# Copy the output into BETTER_AUTH_SECRET=

# Or auto-generate everything:
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
export POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
```

> **💡 Tip:** The installer already generated these for you! Open `.env` and check — you may only need to change `PUBLIC_URL`.

---

## Step 3: Start the Stack

```bash
docker compose up -d
```

The first startup pulls pre-built images from GitHub Container Registry and sets up the database. This takes 1–2 minutes.

---

## Step 4: Verify Everything is Healthy

```bash
docker compose ps
```

You should see **4 containers** all up and healthy:

| Container | Status | Port |
|-----------|--------|------|
| `catalyst-postgres` | healthy | `127.0.0.1:5432` |
| `catalyst-redis` | healthy | `127.0.0.1:6379` |
| `catalyst-backend` | healthy | `127.0.0.1:3000`, `0.0.0.0:2022` |
| `catalyst-frontend` | running | `0.0.0.0:8080` |

If any container shows `unhealthy`, check its logs:

```bash
docker compose logs -f <container-name>
```

---

## Step 5: Log In and Go!

Open your browser and visit `http://localhost:8080` (or whatever you set `PUBLIC_URL` to).

Click **Register** and create your account. **The first user to register automatically becomes the administrator.** 🎉

> **⚠️ Important:** If you used the seed command (`docker compose exec backend bun run db:seed`), the default admin is `admin@example.com` / `admin123`. Change this password immediately after logging in!

---

## 🎉 That's It!

You now have a fully functional Catalyst panel. Here's what you can do next:

| What's Next | Link |
|-------------|------|
| Set up your first location and node | [Getting Started — Create a Location](getting-started.md#step-4-create-a-location) |
| Deploy the Rust agent on a game server node | [Agent Guide](agent.md) |
| Create your first game server | [Getting Started — Create a Server](getting-started.md#step-8-create-your-first-server) |
| Enable HTTPS / TLS for production | [Docker Setup — TLS](docker-setup.md#tls--https-setup) |
| Learn the admin panel | [Admin Guide](admin-guide.md) |

---

## ⚠️ Common Issues

### Port already in use

```bash
# Check what's using port 8080
ss -tlnp | grep :8080

# Change the port in .env
FRONTEND_PORT=0.0.0.0:9090
```

### Podman rootless can't bind port 80

Rootless Podman can't use ports below 1024. Use port `8080` (default), or allow privileged ports:

```bash
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### Can't connect to database

- Make sure `POSTGRES_PASSWORD` is set in `.env`
- Check PostgreSQL is running: `docker compose ps postgres`
- Check logs: `docker compose logs postgres`

### Backend keeps restarting

Usually one of these is missing:
- `BETTER_AUTH_SECRET` — generate one and restart
- `POSTGRES_PASSWORD` — must be set
- `SFTP_HOST_KEY` — set it to empty (`SFTP_HOST_KEY=`) to auto-generate

```bash
docker compose logs -f backend
```

---

## 🔗 Related Docs

| Doc | Why you'd read it |
|-----|-----------------|
| [Installation](installation.md) | Full installation guide with every option |
| [Docker Setup](docker-setup.md) | Deep dive into Docker Compose, volumes, TLS, production hardening |
| [Getting Started](getting-started.md) | Step-by-step walkthrough after the panel is running |
| [Environment Variables](environment-variables.md) | Complete reference for all 60+ config variables |
| [Troubleshooting](troubleshooting.md) | Every error and how to fix it |
