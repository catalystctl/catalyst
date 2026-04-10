FROM rust:1.93 as builder

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
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/catalyst-agent /usr/local/bin/catalyst-agent

EXPOSE 8080

CMD ["/usr/local/bin/catalyst-agent"]
