# Loyalty Card API Proxy

Cloudflare Worker between GitHub Pages and Google Apps Script.

## Required configuration

`wrangler.jsonc` contains non-secret settings:

- `ALLOWED_ORIGIN`
- `GAS_BACKEND_URL`

Set the shared secret separately:

```bash
npm install
npx wrangler secret put API_PROXY_SECRET
```

Use the exact same value in Google Apps Script → Project Settings → Script Properties:

```text
API_PROXY_SECRET=<same high-entropy value>
```

## Deploy

```bash
npm run check
npm run deploy
```

After deployment, copy the Worker URL into `../config.json` as `apiProxyUrl`.

## Routes

- `GET /health` — verifies Proxy → GAS connectivity.
- `POST /rpc` — forwards only allowlisted loyalty RPC methods.
- `OPTIONS /rpc` — CORS preflight.

The Worker does not log request payloads, LIFF ID Tokens, or application Session Tokens.
