#!/bin/bash

# Catalyst Agent - Local Development Build

set -e

echo "Building Catalyst Agent for local development..."

cd "$(dirname "$0")"

# Check Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "Error: Rust is not installed"
    echo "Install from: https://rustup.rs/"
    exit 1
fi

echo "Rust version: $(rustc --version)"

# Build development version
echo ""
echo "Building debug version..."
cargo build

# Build release version (native)
echo ""
echo "Building native release version..."
cargo build --release

# Build static musl release (portable) - only if target is installed
if rustup target list --installed 2>/dev/null | grep -q "x86_64-unknown-linux-musl"; then
    echo ""
    echo "Building static musl release version (portable across Linux distributions)..."
    cargo build --release --target x86_64-unknown-linux-musl
    echo ""
    echo "Static release: ./target/x86_64-unknown-linux-musl/release/catalyst-agent"
else
    echo ""
    echo "Skipping musl build (x86_64-unknown-linux-musl target not installed)."
    echo "To enable portable builds, run:"
    echo "  rustup target add x86_64-unknown-linux-musl"
    echo "  sudo apt-get install -y musl-tools   # Debian/Ubuntu"
fi

echo ""
echo "✓ Agent build complete!"
echo ""
echo "Debug binary:   ./target/debug/catalyst-agent"
echo "Native release: ./target/release/catalyst-agent"
echo ""
echo "To run locally:"
echo "  ./target/debug/catalyst-agent ./config.toml"
echo ""
echo "To build a portable binary (optional):"
echo "  rustup target add x86_64-unknown-linux-musl"
echo "  cargo build --release --target x86_64-unknown-linux-musl"
echo ""
