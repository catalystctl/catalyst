FROM rust:1.86 AS builder

WORKDIR /app

# Copy Cargo files
COPY Cargo.toml Cargo.lock ./

# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

# Copy source
COPY src ./src

# Build
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM ubuntu:24.04

# Install only ca-certificates in the runtime image. The host will provide containerd via mounted socket.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r catalyst -g 1000 && \
    useradd -r -g catalyst -u 1000 -s /sbin/nologin -d /var/lib/catalyst catalyst && \
    mkdir -p /var/lib/catalyst && \
    chown -R catalyst:catalyst /var/lib/catalyst

COPY --from=builder /app/target/release/catalyst-agent /usr/local/bin/catalyst-agent

# No EXPOSE needed — agent connects outbound only (WebSocket client + HTTP poll)

USER catalyst

ENTRYPOINT ["/usr/local/bin/catalyst-agent"]
CMD ["--config", "/opt/catalyst-agent/config.toml"]
