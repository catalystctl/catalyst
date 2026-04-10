#!/bin/bash
# Catalyst Security Hardening Test Suite
# Tests critical security features implemented in the security hardening plan

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

# Test user credentials
TEST_USER_EMAIL="security-test@example.com"
TEST_USER_PASSWORD="SecurePassword123!"

# Helper functions
log_test() {
    echo -e "${YELLOW}[TEST]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

# Setup - Create test user and get tokens
setup() {
    log_test "Setting up test environment..."

    # Register test user
    curl -s -X POST "${BACKEND_URL}/api/auth/register" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${TEST_USER_EMAIL}\",\"username\":\"securitytest\",\"password\":\"${TEST_USER_PASSWORD}\"}" \
        > /dev/null 2>&1 || true

    # Login to get token
    LOGIN_RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${TEST_USER_EMAIL}\",\"password\":\"${TEST_USER_PASSWORD}\"}")

    TEST_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.token // .token // empty')

    if [ -z "$TEST_TOKEN" ]; then
        log_fail "Failed to get authentication token"
        exit 1
    fi

    log_success "Setup complete"
}

# Test 1: Path Traversal Protection
test_path_traversal() {
    log_test "Test 1: Path Traversal Protection"

    # Try to access files outside server directory
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/servers/test-server/files/read" \
        -H "Authorization: Bearer ${TEST_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"path":"../../../etc/passwd"}')

    if echo "$RESPONSE" | grep -q "Path traversal\|Invalid path\|validation failed"; then
        log_success "Path traversal attempt blocked"
    else
        log_fail "Path traversal attempt not blocked"
        return 1
    fi

    # Try absolute path
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/servers/test-server/files/read" \
        -H "Authorization: Bearer ${TEST_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"path":"/etc/passwd"}')

    if echo "$RESPONSE" | grep -q "Path traversal\|Invalid path\|validation failed"; then
        log_success "Absolute path attempt blocked"
    else
        log_fail "Absolute path attempt not blocked"
        return 1
    fi

    log_success "Path traversal protection working correctly"
}

# Test 2: XSS Prevention
test_xss_prevention() {
    log_test "Test 2: XSS Prevention"

    # Try to create server with XSS payload
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/servers" \
        -H "Authorization: Bearer ${TEST_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"name":"<script>alert(1)</script>","templateId":"test","nodeId":"test"}')

    if echo "$RESPONSE" | grep -q "error\|validation\|sanitized"; then
        log_success "XSS payload in server name rejected"
    else
        log_fail "XSS payload not properly sanitized"
        return 1
    fi

    log_success "XSS prevention working correctly"
}

# Test 3: Brute Force Protection
test_brute_force() {
    log_test "Test 3: Brute Force Protection"

    # Attempt multiple failed logins
    log_test "Attempting 6 failed logins (should trigger lockout)..."

    for i in {1..6}; do
        curl -s -X POST "${BACKEND_URL}/api/auth/login" \
            -H "Content-Type: application/json" \
            -d "{\"email\":\"${TEST_USER_EMAIL}\",\"password\":\"wrongpassword\"}" \
            > /dev/null 2>&1
    done

    # Check if account is locked
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${TEST_USER_EMAIL}\",\"password\":\"wrongpassword\"}")

    if echo "$RESPONSE" | grep -q "Account locked\|locked\|try again"; then
        log_success "Brute force protection triggered - account locked"
    else
        log_fail "Brute force protection not working"
        return 1
    fi

    log_success "Brute force protection working correctly"
}

# Test 4: CSRF Protection
test_csrf_protection() {
    log_test "Test 4: CSRF Protection"

    # Try to perform action without CSRF token
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/servers" \
        -H "Cookie: session=test" \
        -H "Content-Type: application/json" \
        -d '{"name":"test","templateId":"test","nodeId":"test"}')

    if echo "$RESPONSE" | grep -q "CSRF\|Invalid CSRF\|Forbidden"; then
        log_success "CSRF token validation working"
    else
        log_fail "CSRF protection not enforced"
        return 1
    fi

    log_success "CSRF protection working correctly"
}

# Test 5: Password Complexity
test_password_complexity() {
    log_test "Test 5: Password Complexity Requirements"

    # Try to register with weak password
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/auth/register" \
        -H "Content-Type: application/json" \
        -d '{"email":"weak@example.com","username":"weakuser","password":"weak"}')

    if echo "$RESPONSE" | grep -q "Password does not meet requirements\|at least 12 characters"; then
        log_success "Weak password rejected"
    else
        log_fail "Weak password accepted"
        return 1
    fi

    # Try with password missing special character
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/auth/register" \
        -H "Content-Type: application/json" \
        -d '{"email":"nospecial@example.com","username":"nospecial","password":"PasswordWithoutSpecial123"}')

    if echo "$RESPONSE" | grep -q "special character"; then
        log_success "Password without special character rejected"
    else
        log_fail "Password complexity not fully enforced"
        return 1
    fi

    log_success "Password complexity requirements working correctly"
}

# Test 6: Rate Limiting
test_rate_limiting() {
    log_test "Test 6: Rate Limiting"

    # Make rapid requests
    log_test "Making rapid requests to test rate limiting..."

    SUCCESS_COUNT=0
    for i in {1..70}; do
        RESPONSE=$(curl -s -X GET "${BACKEND_URL}/api/servers" \
            -H "Authorization: Bearer ${TEST_TOKEN}")

        if echo "$RESPONSE" | grep -q "Too many requests\|rate limit"; then
            break
        fi

        if ! echo "$RESPONSE" | grep -q "error"; then
            ((SUCCESS_COUNT++))
        fi
    done

    if [ $SUCCESS_COUNT -lt 70 ]; then
        log_success "Rate limiting triggered after $SUCCESS_COUNT successful requests"
    else
        log_fail "Rate limiting not working (allowed $SUCCESS_COUNT requests)"
        return 1
    fi

    log_success "Rate limiting working correctly"
}

# Test 7: Permission Enforcement
test_permission_enforcement() {
    log_test "Test 7: Permission Enforcement"

    # Try to access server without permission
    RESPONSE=$(curl -s -X GET "${BACKEND_URL}/api/servers/some-other-server-id" \
        -H "Authorization: Bearer ${TEST_TOKEN}")

    if echo "$RESPONSE" | grep -q "Forbidden\|403\|Unauthorized\|401"; then
        log_success "Permission enforcement working"
    else
        log_fail "Permission bypass possible"
        return 1
    fi

    log_success "Permission enforcement working correctly"
}

# Test 8: HttpOnly Cookie Check
test_httponly_cookies() {
    log_test "Test 8: HttpOnly Cookie Configuration"

    # Make a login request and check response headers
    RESPONSE=$(curl -s -i -X POST "${BACKEND_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${TEST_USER_EMAIL}\",\"password\":\"${TEST_USER_PASSWORD}\"}")

    if echo "$RESPONSE" | grep -qi "Set-Cookie.*HttpOnly"; then
        log_success "HttpOnly cookies are being set"
    else
        log_fail "HttpOnly cookies not configured"
        return 1
    fi

    if echo "$RESPONSE" | grep -qi "Set-Cookie.*Secure"; then
        log_success "Secure flag set on cookies"
    else
        log_fail "Secure flag not set on cookies (required for production)"
        return 1
    fi

    if echo "$RESPONSE" | grep -qi "Set-Cookie.*SameSite=Strict"; then
        log_success "SameSite=Strict set on cookies"
    else
        log_fail "SameSite protection not configured"
        return 1
    fi

    log_success "Cookie security configuration correct"
}

# Test 9: Input Validation
test_input_validation() {
    log_test "Test 9: Input Validation"

    # Test SQL injection attempts
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/servers" \
        -H "Authorization: Bearer ${TEST_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"name":"\' OR 1=1 --","templateId":"test","nodeId":"test"}')

    if echo "$RESPONSE" | grep -q "error\|validation\|sanitized"; then
        log_success "SQL injection attempt blocked"
    else
        log_fail "SQL injection protection not working"
        return 1
    fi

    # Test overly long input
    LONG_NAME=$(python3 -c "print('a'*1000)")
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/servers" \
        -H "Authorization: Bearer ${TEST_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"${LONG_NAME}\",\"templateId\":\"test\",\"nodeId\":\"test\"}")

    if echo "$RESPONSE" | grep -q "too long\|exceeds\|validation"; then
        log_success "Overly long input rejected"
    else
        log_fail "Input length validation not working"
        return 1
    fi

    log_success "Input validation working correctly"
}

# Test 10: Security Headers
test_security_headers() {
    log_test "Test 10: Security Headers"

    # Check for security headers
    RESPONSE=$(curl -s -I -X GET "${BACKEND_URL}/api/servers")

    if echo "$RESPONSE" | grep -qi "Content-Security-Policy"; then
        log_success "CSP header present"
    else
        log_fail "CSP header missing"
        return 1
    fi

    if echo "$RESPONSE" | grep -qi "X-Frame-Options.*DENY\|X-Frame-Options.*SAMEORIGIN"; then
        log_success "X-Frame-Options header present"
    else
        log_fail "X-Frame-Options header missing"
        return 1
    fi

    if echo "$RESPONSE" | grep -qi "X-Content-Type-Options.*nosniff"; then
        log_success "X-Content-Type-Options header present"
    else
        log_fail "X-Content-Type-Options header missing"
        return 1
    fi

    if echo "$RESPONSE" | grep -qi "Strict-Transport-Security"; then
        log_success "HSTS header present"
    else
        log_fail "HSTS header missing (required for production)"
        return 1
    fi

    log_success "Security headers configured correctly"
}

# Cleanup
cleanup() {
    log_test "Cleaning up test environment..."

    # Delete test user if exists
    curl -s -X DELETE "${BACKEND_URL}/api/admin/users/security-test@example.com" \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        > /dev/null 2>&1 || true

    log_success "Cleanup complete"
}

# Main test execution
main() {
    echo "=========================================="
    echo "Catalyst Security Hardening Test Suite"
    echo "=========================================="
    echo ""

    setup
    echo ""

    # Run all tests
    test_path_traversal || exit 1
    test_xss_prevention || exit 1
    test_brute_force || exit 1
    test_csrf_protection || exit 1
    test_password_complexity || exit 1
    test_rate_limiting || exit 1
    test_permission_enforcement || exit 1
    test_httponly_cookies || exit 1
    test_input_validation || exit 1
    test_security_headers || exit 1

    echo ""
    echo "=========================================="
    echo -e "${GREEN}All security tests passed!${NC}"
    echo "=========================================="

    cleanup
}

# Run tests
main
