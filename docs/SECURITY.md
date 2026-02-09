# Security Policy

## License and Security

Catalyst is licensed under the **GNU General Public License v3.0 (GPLv3)**. This means:

- **You have the right to study** how the software works and modify it
- **You have the right to distribute** copies and modifications
- **Security through transparency**: The source code is open for security review
- **No additional restrictions**: Security measures must not restrict GPL freedoms

This security policy complements, but does not override, your rights under the GPLv3 license.

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

- We will not take legal action against security researchers who:
  - Follow this disclosure process
  - Act in good faith
  - Avoid privacy violations and data destruction
  - Avoid service disruption
  - Respect the GPLv3 license terms

- We acknowledge your GPLv3 rights to:
  - Study, modify, and redistribute this software
  - Report security issues publicly if you choose
  - Create and distribute security patches independently

- We kindly request coordinated disclosure to:
  - Protect users running unpatched versions
  - Provide time for users to update
  - Coordinate fixes across the community
  - **This is a request, not a legal requirement under GPL**

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

## Security and GPL Freedoms

### Your Rights Under GPLv3

The GPLv3 license grants you important freedoms that apply to security:

1. **Freedom to Study**: You can examine the source code for security vulnerabilities
2. **Freedom to Modify**: You can create and deploy security patches
3. **Freedom to Distribute**: You can share security fixes with others
4. **No Tivoization**: Hardware running Catalyst cannot prevent you from running modified versions

### Anti-Tivoization (GPLv3 Section 6)

If you distribute Catalyst on hardware devices:
- You must provide Installation Information to allow users to install modified versions
- Users must be able to install security patches they create
- Technical protection measures cannot prevent modification
- This protects users' ability to secure their own systems

### Patent Grant (GPLv3 Section 11)

By contributing to or distributing Catalyst:
- You grant a patent license for your contributions
- You cannot use patent claims to restrict security fixes
- Contributors cannot sue users for patent infringement related to security patches

### Coordinated vs. Public Disclosure

Under GPLv3, you have the right to:
- **Publicly disclose** vulnerabilities immediately if you choose
- **Create and distribute** security patches independently
- **Fork the project** with security improvements

However, we kindly request:
- **Coordinated disclosure** to protect users of unpatched versions
- **Reasonable time** for maintainers to develop and test fixes (typically 90 days)
- **Collaboration** on fixes when possible

**This is a request for responsible disclosure, not a legal restriction. Your GPL rights remain intact.**

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

Catalyst is **free and open-source software**. Security features include:

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

**All security features are open-source and auditable.** You are free to review, modify, and improve them under the GPLv3 license.

## Community Security

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

- **GPLv3 License**: [LICENSE](LICENSE)
- **GNU GPL FAQ**: https://www.gnu.org/licenses/gpl-faq.html
- **FSF Security Guidelines**: https://www.fsf.org/
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security)
- [Catalyst Documentation](https://github.com/karutoil/catalyst/blob/main/README.md)

## GPL Compliance

If you distribute Catalyst (modified or unmodified):
- **Provide source code** or a written offer for source code
- **Include license notices** (GPLv3 LICENSE file)
- **Preserve copyright notices** in all files
- **Document modifications** you've made
- **License derivative works** under GPLv3
- **Provide Installation Information** if distributed on hardware

For security-related modifications:
- You may add additional permissions (GPLv3 Section 7)
- You cannot add additional restrictions
- Security fixes must remain GPLv3 licensed

## Contact

For security-related questions or concerns:

- **Security Advisories**: https://github.com/karutoil/catalyst/security/advisories
- **General Issues**: https://github.com/karutoil/catalyst/issues

---

**Thank you for helping keep Catalyst secure!** 🔒
