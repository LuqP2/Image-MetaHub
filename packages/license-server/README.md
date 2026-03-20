# Image MetaHub License Server

Small standalone backend for license activation, refresh, trial issuance, and per-device activation limits.

## Features

- Separate from the desktop app
- JSON file persistence for fast local setup
- Ed25519 signed entitlements
- Supports `annual`, `lifetime`, and `trial`
- Enforces max active devices per license

## Quick Start

1. Generate a signing keypair:

```bash
node cli.mjs generate-keypair
```

2. Create a license:

```bash
node cli.mjs create-license --email you@example.com --plan annual --days 365
```

3. Start the server:

```bash
node server.mjs
```

4. Copy the generated public key into the app settings under `License Public Key`.

5. Point the app to the backend URL in `License Backend URL`.

## Environment Variables

- `IMH_LICENSE_SERVER_PORT`: default `8787`
- `IMH_LICENSE_DB_PATH`: path to JSON database
- `IMH_LICENSE_PRIVATE_KEY_PATH`: path to Ed25519 private key PEM
- `IMH_LICENSE_PUBLIC_KEY_PATH`: path to Ed25519 public key PEM
- `IMH_LICENSE_OFFLINE_GRACE_DAYS`: default `14`
- `IMH_LICENSE_REFRESH_DAYS`: default `7`

## API

- `GET /health`
- `POST /v1/licenses/activate`
- `POST /v1/licenses/refresh`
- `POST /v1/licenses/deactivate`
- `POST /v1/trials/start`
