FROM rust:1-bookworm AS builder

WORKDIR /app

# Copy Cargo files + pinned toolchain
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./

# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

# Copy source
COPY src ./src

# Build
# ponytail: Dockerfile builds gnu target but updater expects musl asset name
# (catalyst-agent-x86_64-linux-musl) — align release-pipeline asset naming in a follow-up
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM ubuntu:24.04

# Install only ca-certificates in the runtime image. The host will provide containerd via mounted socket.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    (getent group catalyst 2>/dev/null || groupadd -r catalyst) && \
    (getent passwd catalyst 2>/dev/null || useradd -r -g catalyst -s /sbin/nologin -d /var/lib/catalyst catalyst) && \
    mkdir -p /var/lib/catalyst && \
    chown -R catalyst:catalyst /var/lib/catalyst

COPY --from=builder /app/target/release/catalyst-agent /usr/local/bin/catalyst-agent

# No EXPOSE needed — agent connects outbound only (WebSocket client + HTTP poll)

USER catalyst

# NOTE: The agent requires root at runtime for: mount/umount, CNI config,
# containerd socket access, fallocate, firewall rules, and sudo password caching.
# The `catalyst` user above is for development/testing only.
# Production deployments use the systemd service (deploy-agent.sh) which runs as root.
# Running as non-root in Docker gives a false sense of security since the agent
# cannot perform its core functions without elevated privileges.

ENTRYPOINT ["/usr/local/bin/catalyst-agent"]
CMD ["--config", "/opt/catalyst-agent/config.toml"]
