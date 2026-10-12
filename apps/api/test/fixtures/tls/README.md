# Test-only TLS certificate

A self-signed certificate for `localhost` / `127.0.0.1` (valid 100 years), used by
`test/unit/ai-connections.test.ts` to check that AI connections refuse an untrusted certificate unless the
"Skip TLS certificate checks" switch is on. It protects nothing: never use it outside tests.

Regenerate with:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout localhost.key -out localhost.crt -days 36500 \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```
