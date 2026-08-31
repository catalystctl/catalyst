# Canned reply: request logs from issue reporters

Post this as a reply when a bug report comes in.

---

Thanks for the report! To dig into this, we need three sets of logs. Please attach all of them to this issue:

**1. Panel → System Errors tab**

Log in to the panel as an admin, go to **Admin → System Errors** (`/admin/system-errors`), find the entries from around the time the problem happened, and for each one click **View details → Copy for AI**, then paste the result here. If there are many, the most recent 3–5 are fine.

**2. Docker (panel) logs**

Run this from the directory where you installed the panel (the folder containing `docker-compose.yml`):

```bash
cd /path/to/panel-install
docker compose ps
docker compose logs --since 24h > panel-docker-logs.txt
```

Attach `panel-docker-logs.txt` (you can adjust `--since`, e.g. `2h`, to cover when it happened).

**3. Agent logs**

The agent runs as a systemd service. On the node, run:

```bash
sudo journalctl -u catalyst-agent --since "24 hours ago" --no-pager > catalyst-agent-logs.txt
```

If the problem involves servers failing to deploy or start, also grab:

```bash
sudo journalctl -u containerd --since "24 hours ago" --no-pager > containerd-logs.txt
sudo tar czf console-logs.tgz -C /var/log/catalyst/console <SERVER_ID>/
```

Attach the output files.

**⚠️ Before posting — redact secrets.** Logs can contain JWT secrets, database passwords, agent deploy tokens, and API keys. Please strip anything that looks like a token or password before attaching.

It also helps to include your panel version (bottom of the admin area), agent version (`catalyst-agent --version`), and OS/distro.
