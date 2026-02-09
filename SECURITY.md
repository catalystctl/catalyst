# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| develop | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Catalyst seriously. If you discover a security vulnerability, please follow these steps:

### Private Disclosure Process

**Do not** report security vulnerabilities through public GitHub issues.

Instead, please report them via one of the following methods:

1. **GitHub Security Advisories (Preferred)**
   - Navigate to the [Security tab](https://github.com/karutoil/catalyst/security/advisories)
   - Click "Report a vulnerability"
   - Fill out the advisory form with details

2. **Email**
   - Send an email to: [security@catalyst-project.com](mailto:security@catalyst-project.com)
   - Use PGP key: [Available on request]
   - Include detailed information about the vulnerability

### What to Include

Please include the following information in your report:

- **Type of vulnerability** (e.g., SQL injection, XSS, authentication bypass)
- **Affected component(s)** (backend, frontend, agent, or infrastructure)
- **Step-by-step reproduction instructions**
- **Proof of concept or exploit code** (if applicable)
- **Impact assessment** (what an attacker could achieve)
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up questions

### What to Expect

After you submit a report, you can expect:

1. **Acknowledgment within 48 hours** confirming we received your report
2. **Initial assessment within 5 business days** with severity rating
3. **Regular updates** on our progress (at least every 7 days)
4. **Coordinated disclosure timeline** if the vulnerability is confirmed
5. **Credit in the security advisory** (if desired) once the issue is resolved

### Our Commitment

- We will not take legal action against researchers who:
  - Follow this disclosure process
  - Act in good faith
  - Avoid privacy violations and data destruction
  - Avoid service disruption

- We will work with you to:
  - Understand and validate the vulnerability
  - Develop and test a fix
  - Coordinate public disclosure timing
  - Give credit for the discovery (if desired)

## Security Vulnerability Response

### Severity Levels

We classify vulnerabilities using the following severity levels:

- **Critical**: Immediate action required (remote code execution, authentication bypass)
- **High**: Prompt action required (privilege escalation, data exposure)
- **Medium**: Scheduled fix in next release (information disclosure, DoS)
- **Low**: Fix when convenient (minor information leak, low-impact bugs)

### Patch Timeline

- **Critical**: Patch within 24-48 hours, emergency release
- **High**: Patch within 7 days, expedited release
- **Medium**: Patch within 30 days, next scheduled release
- **Low**: Patch within 90 days, regular release cycle

## Security Best Practices

### For Developers

- **Never commit secrets** (API keys, passwords, tokens) to the repository
- **Use environment variables** for all sensitive configuration
- **Keep dependencies updated** using Dependabot alerts
- **Run security scans** before merging PRs (`npm audit`, `cargo audit`)
- **Review RBAC permissions** when adding new endpoints
- **Validate all user input** on both frontend and backend
- **Use parameterized queries** to prevent SQL injection
- **Sanitize file paths** to prevent path traversal attacks

### For Deployment

- **Use TLS/HTTPS** for all production deployments
- **Rotate secrets regularly** (JWT secrets, database passwords)
- **Enable database encryption** at rest
- **Implement rate limiting** on all public APIs
- **Use strong passwords** for all services (25+ characters)
- **Enable audit logging** for privileged operations
- **Keep systems patched** and up-to-date
- **Use container isolation** to limit blast radius
- **Implement network segmentation** between services
- **Regular security audits** of infrastructure

### For Users

- **Use strong passwords** for your Catalyst account
- **Enable 2FA** when available (coming soon)
- **Review permissions** before granting access
- **Report suspicious activity** immediately
- **Keep your instance updated** with the latest security patches
- **Monitor audit logs** regularly for unusual behavior
- **Use API tokens** instead of passwords for automation
- **Revoke unused tokens** and credentials

## Security Features

Catalyst includes the following security features:

- **JWT-based authentication** with configurable expiration
- **Role-based access control (RBAC)** with fine-grained permissions
- **Path validation** to prevent directory traversal
- **Input sanitization** on all user-provided data
- **SQL injection protection** via Prisma ORM
- **Audit logging** for all privileged operations
- **Rate limiting** on authentication endpoints
- **Container isolation** for game servers
- **Secret scanning** in CI/CD pipelines (gitleaks)
- **Dependency scanning** via Dependabot
- **SFTP chroot jails** for file access isolation

## Known Security Considerations

### Agent-Backend Communication

- Agent authentication uses a shared secret (`NODE_SECRET`)
- WebSocket connections are not encrypted by default
- **Recommendation**: Deploy backend with TLS/WSS in production
- **Recommendation**: Use VPN or private network for agent-backend communication

### File Operations

- File operations are restricted to server-specific directories
- Path traversal protection implemented in both backend and agent
- SFTP provides chrooted access per server

### Database Access

- Database credentials stored in environment variables
- Prisma ORM provides SQL injection protection
- **Recommendation**: Use read-only credentials where possible
- **Recommendation**: Enable PostgreSQL SSL in production

## Security Disclosure History

No security vulnerabilities have been publicly disclosed yet.

When vulnerabilities are disclosed, they will be listed here with:
- CVE identifier (if applicable)
- Severity rating
- Affected versions
- Fixed version
- Credit to reporter (if desired)

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security)
- [Catalyst Documentation](https://github.com/karutoil/catalyst/blob/main/README.md)

## Contact

For security-related questions or concerns, contact:

- **Security Email**: security@catalyst-project.com
- **General Issues**: https://github.com/karutoil/catalyst/issues
- **Security Advisories**: https://github.com/karutoil/catalyst/security/advisories

---

**Thank you for helping keep Catalyst secure!** 🔒
