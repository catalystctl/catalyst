#!/bin/bash
# Quick local CI checks without Docker overhead
# Runs the same steps as CI but directly on the host

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_step() {
    echo -e "${GREEN}▶ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Backend CI steps
test_backend() {
    print_step "Testing Backend CI steps..."
    cd catalyst-backend

    print_step "Install dependencies..."
    bun install --frozen-lockfile

    print_step "Generate Prisma Client..."
    bunx prisma generate > /dev/null

    print_step "Security audit (high severity only)..."
    bun pm scan || print_warning "Security vulnerabilities found"

    print_step "Lint..."
    bun run lint

    print_step "Build..."
    bun run build

    print_success "Backend CI steps passed!"
    cd ..
}

# Agent CI steps
test_agent() {
    print_step "Testing Agent CI steps..."
    cd catalyst-agent

    print_step "cargo check..."
    cargo check --quiet

    print_step "cargo fmt check..."
    cargo fmt -- --check

    print_step "cargo clippy..."
    cargo clippy --quiet -- -D warnings

    print_step "cargo test..."
    cargo test --quiet

    print_success "Agent CI steps passed!"
    cd ..
}

# Security check
test_security() {
    print_step "Testing Security checks..."

    if ! command -v gitleaks &> /dev/null; then
        print_warning "gitleaks not installed, skipping"
        return 0
    fi

    print_step "Running gitleaks..."
    if gitleaks detect --no-banner; then
        print_success "No secrets detected"
    else
        print_error "Secrets detected!"
        return 1
    fi
}

# Show help
show_help() {
    cat << EOF
Quick Local CI Testing (without Docker overhead)

Usage: $0 [command]

Commands:
  backend   Run backend CI steps
  agent     Run agent CI steps  
  security  Run security checks
  all       Run all checks (default)
  help      Show this help

Examples:
  $0           # Run all checks
  $0 backend   # Test backend only
  $0 agent     # Test agent only
EOF
}

# Main
case "${1:-all}" in
    backend)
        test_backend
        ;;
    agent)
        test_agent
        ;;
    security)
        test_security
        ;;
    all)
        test_backend
        echo ""
        test_agent
        echo ""
        test_security
        echo ""
        print_success "All CI checks passed!"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
