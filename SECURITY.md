# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **DO NOT** open a public GitHub issue
2. Email security details to the maintainer
3. Include a description of the vulnerability
4. Include steps to reproduce
5. Suggest a fix if possible

## Known Security Considerations

### Build-Time Dependencies (Low Risk)

This project uses Apache Cordova for Android builds. The `npm audit` report shows vulnerabilities in Cordova's transitive dependencies:

- **dep-graph** depends on vulnerable `underscore`
- **uuid** has buffer bounds check issues (v3/v5/v6)
- **xml2js** has prototype pollution vulnerability

**Risk assessment**: These are build-time dependencies only. They do not execute in the app's runtime environment (Android WebView). The vulnerabilities affect the build toolchain, not the end user.

### Runtime Security

The app executes code in a sandboxed Android WebView with these protections:

- Content Security Policy (CSP) headers
- No direct filesystem access from JavaScript
- All file operations go through the Cordova plugin bridge
- AI API keys are stored in Android's encrypted SharedPreferences

### API Key Security

- API keys are stored using Android Keystore system
- Keys never leave the device except when making API calls
- No keys are committed to the repository
- All API calls use HTTPS

## Security Scanning

This project uses:

- **CodeQL** for static analysis (runs on every push and PR)
- **npm audit** for dependency vulnerability scanning
- **Biome** for code quality and potential security issues

## Best Practices for Contributors

1. Never commit API keys, passwords, or secrets
2. Use environment variables for sensitive configuration
3. Follow OWASP Mobile Security guidelines
4. Review code for injection vulnerabilities
5. Test with realistic user data
