# Self-Hosting HiveChat

HiveChat is designed to run anywhere Docker runs. This guide covers
deployment on a VPS with automatic HTTPS.

## Requirements

- A server with Docker and Docker Compose installed
- A domain name (for HTTPS) - or just use localhost for testing
- 1GB+ RAM recommended

## Quick Start (localhost)

```bash
git clone https://github.com/Therealnickjames/Hive-Chat.git
cd Hive-Chat

# Generate secure config
./scripts/setup.sh

# Start all services
docker compose up -d

# Verify
docker compose ps        # all services should be "Up"
make health              # three OK responses

# Open http://localhost:3000
```

## Production Deployment (with HTTPS)

### 1. Set up your server

On a fresh Ubuntu/Debian VPS:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose plugin
sudo apt install docker-compose-plugin

# Clone HiveChat
git clone https://github.com/Therealnickjames/Hive-Chat.git
cd Hive-Chat
```

### 2. Configure

Run the setup script and enter your domain when prompted:

```bash
./scripts/setup.sh
```

This generates `.env` with:

- Secure random secrets for JWT, encryption, session signing
- Database credentials
- Your domain configuration
- WebSocket URL (`wss://` for production)

### 3. Point DNS

Create an A record pointing your domain to your server's IP:

```text
chat.example.com  ->  203.0.113.1
```

Wait for DNS propagation (usually 1-5 minutes).

### 4. Launch

```bash
docker compose --profile production up -d
```

This starts all services plus Caddy, which automatically:

- Obtains a Let's Encrypt TLS certificate
- Serves the web app over HTTPS
- Proxies WebSocket connections to the Gateway
- Renews certificates automatically

### 5. Verify

```bash
docker compose ps
```

All 6 services should be running: db, redis, web, gateway, streaming, caddy.

Open `https://your-domain.com` - you should see the HiveChat login page.

## Architecture

```text
Internet
   |
   v
+---------+
|  Caddy  |  :80/:443 - HTTPS termination, reverse proxy
+----+----+
     |
     +---------> web      :3000  - Next.js (UI, API, database)
     |
     +---------> gateway  :4001  - Phoenix (WebSocket, presence)
                    |
                    +------> streaming :4002 - Go (LLM streaming)

     All services --> db     :5432 (PostgreSQL)
     All services --> redis  :6379 (pub/sub)
```

## Configuration Reference

All configuration is in `.env`. Key variables:

|Variable|Description|Example|
|---|---|---|
|`DOMAIN`|Your domain name|`chat.example.com`|
|`NEXTAUTH_URL`|Full URL of the app|`https://chat.example.com`|
|`NEXT_PUBLIC_GATEWAY_URL`|WebSocket URL|`wss://chat.example.com/socket`|
|`POSTGRES_PASSWORD`|Database password|(auto-generated)|
|`JWT_SECRET`|JWT signing secret|(auto-generated)|
|`ENCRYPTION_KEY`|Bot API key encryption|(auto-generated)|

## Updating

```bash
cd Hive-Chat
git pull
docker compose --profile production up -d --build
```

Database migrations run automatically on startup.

## Backups

### Database

```bash
docker compose exec db pg_dump -U hivechat hivechat > backup.sql
```

### Restore

```bash
cat backup.sql | docker compose exec -T db psql -U hivechat hivechat
```

### Uploaded Files

Files are stored in the `uploads-data` Docker volume. Back up with:

```bash
docker run --rm -v hive-chat_uploads-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/uploads-backup.tar.gz -C /data .
```

## Troubleshooting

### Services won't start

```bash
docker compose logs web       # Check for build errors
docker compose logs gateway   # Check for connection errors
docker compose logs caddy     # Check for certificate errors
```

Database auth fails after re-running `setup.sh`: If you regenerated secrets with an existing database volume, the new password won't match. Run `docker compose down -v` to reset, then `docker compose up -d`.

### WebSocket won't connect

Verify `NEXT_PUBLIC_GATEWAY_URL` in `.env`:

- Local: `ws://localhost:4001/socket`
- Production: `wss://your-domain.com/socket`

### Certificate issues

Caddy handles certs automatically. If it fails:

- Verify DNS points to your server
- Check port 80 and 443 are open
- Check Caddy logs: `docker compose logs caddy`

### Reset everything

```bash
docker compose down -v  # WARNING: destroys all data
./scripts/setup.sh      # Re-generate config
docker compose --profile production up -d
```
