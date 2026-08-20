# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | Yes                |
| < 1.0   | No                 |

## Reporting a Vulnerability

If you discover a security vulnerability in hevc.js, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, use one of these channels:

1. **GitHub Security Advisories** (preferred): [Report a vulnerability](https://github.com/lid-labs/hevc.js/security/advisories/new)
2. **Email**: contact@developpement.ai

### What to include

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact

### Response timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 1 week
- **Fix release**: depends on severity, typically within 2 weeks for critical issues

## Scope

This policy covers:

- `@hevcjs/core` — the WASM HEVC decoder and TypeScript bindings
- `@hevcjs/dashjs-plugin` — the dash.js integration plugin
- The C++ decoder source code compiled to WebAssembly
