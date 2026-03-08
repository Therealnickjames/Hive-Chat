#!/usr/bin/env bash
set -euo pipefail

# Tavok Setup Script
# Generates .env with secure random secrets for production deployment.
#
# Usage:
#   ./scripts/setup.sh                     # interactive (prompts for domain)
#   ./scripts/setup.sh --domain example.com # non-interactive
#   ./scripts/setup.sh --domain localhost   # non-interactive, localhost

# --- Error handling ---
trap 'echo ""; echo "ERROR: Setup failed at line $LINENO. Run \"bash -x scripts/setup.sh\" to debug." >&2' ERR

# --- Argument parsing ---
DOMAIN_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN_ARG="$2"
      shift 2
      ;;
    --domain=*)
      DOMAIN_ARG="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: setup.sh [--domain <domain>]"
      echo ""
      echo "Options:"
      echo "  --domain <domain>  Set domain (skip interactive prompt)"
      echo "                     Use 'localhost' for local development"
      echo ""
      echo "If --domain is omitted, the script will prompt interactively."
      echo "In non-interactive environments (piped input, CI), defaults to localhost."
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run: setup.sh --help" >&2
      exit 1
      ;;
  esac
done

echo ""
echo "======================================="
echo "         Tavok Setup Script"
echo "======================================="
echo ""

# --- Prerequisite checks ---
if ! command -v openssl &>/dev/null; then
  echo "ERROR: 'openssl' is required but not found." >&2
  echo "" >&2
  echo "Install it:" >&2
  echo "  Ubuntu/Debian: sudo apt install openssl" >&2
  echo "  macOS:         brew install openssl" >&2
  echo "  Alpine:        apk add openssl" >&2
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: 'docker' is required but not found." >&2
  echo "" >&2
  echo "Install Docker Engine: https://docs.docker.com/engine/install/" >&2
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "ERROR: 'docker compose' (v2) is required but not found." >&2
  echo "" >&2
  echo "Docker Compose v2 ships with Docker Desktop and recent Docker Engine." >&2
  echo "See: https://docs.docker.com/compose/install/" >&2
  exit 1
fi

# --- Network connectivity check ---
# docker compose up -d pulls pre-built images (needs registry access).
# docker compose up --build needs package mirrors too.
echo "Checking network connectivity..."
NETWORK_OK=true
NETWORK_WARNINGS=""
# GHCR is required (pre-built images). Package mirrors only needed for --build.
for host in ghcr.io; do
  if ! curl -sf --connect-timeout 5 --max-time 10 "https://$host" -o /dev/null 2>/dev/null; then
    NETWORK_OK=false
    echo "" >&2
    echo "ERROR: Cannot reach ghcr.io (GitHub Container Registry)." >&2
    echo "'docker compose up -d' pulls pre-built images and needs registry access." >&2
    echo "" >&2
    echo "Check your internet connection and DNS settings." >&2
    echo "If using Docker with iptables disabled, see:" >&2
    echo "  https://github.com/TavokAI/Tavok/blob/main/docs/INSTALL.md#docker-containers-cant-reach-the-internet" >&2
    exit 1
  fi
done
echo "  ✓ Container registry reachable (ghcr.io)"

# Optional: warn if package mirrors are unreachable (only matters for --build)
for host in dl-cdn.alpinelinux.org registry.npmjs.org hex.pm proxy.golang.org; do
  if ! curl -sf --connect-timeout 5 --max-time 10 "https://$host" -o /dev/null 2>/dev/null; then
    NETWORK_WARNINGS="${NETWORK_WARNINGS}  ⚠ $host unreachable (only needed for docker compose up --build)\n"
  fi
done
if [ -n "$NETWORK_WARNINGS" ]; then
  echo -e "$NETWORK_WARNINGS"
  echo "  Note: Pre-built images will be pulled from ghcr.io. Building from source may fail."
fi

# --- Check for existing .env ---
if [ -f .env ]; then
  if [ -n "$DOMAIN_ARG" ]; then
    echo ".env already exists. Overwriting (--domain flag passed)."
  elif [ -t 0 ]; then
    read -rp ".env file already exists. Overwrite? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  else
    echo ".env already exists. Overwriting (non-interactive mode)."
  fi
fi

# --- Generate secrets ---
generate_secret() {
  local result
  result=$(openssl rand -base64 "$1" | tr -d '=+/\n') || {
    echo "ERROR: Failed to generate secret (openssl rand failed)." >&2
    exit 1
  }
  echo "$result"
}

generate_hex() {
  local result
  result=$(openssl rand -hex "$1") || {
    echo "ERROR: Failed to generate hex secret (openssl rand failed)." >&2
    exit 1
  }
  echo "$result"
}

NEXTAUTH_SECRET=$(generate_secret 32)
JWT_SECRET=$(generate_secret 32)
INTERNAL_API_SECRET=$(generate_secret 32)
SECRET_KEY_BASE=$(generate_secret 64)
ENCRYPTION_KEY=$(generate_hex 32)
POSTGRES_PASSWORD=$(generate_secret 16)
REDIS_PASSWORD=$(generate_secret 32)

# --- Determine domain ---
if [ -n "$DOMAIN_ARG" ]; then
  DOMAIN="$DOMAIN_ARG"
elif [ -t 0 ]; then
  echo ""
  read -rp "Your domain (e.g., chat.example.com) or press Enter for localhost: " DOMAIN
  DOMAIN=${DOMAIN:-localhost}
else
  # Non-interactive, no --domain flag: default to localhost
  DOMAIN="localhost"
  echo "Non-interactive mode detected. Defaulting to localhost."
  echo "Use --domain <domain> to set a custom domain."
fi

if [ "$DOMAIN" = "localhost" ]; then
  NEXTAUTH_URL="http://localhost:5555"
  GATEWAY_WS_URL="ws://localhost:4001/socket"
  CADDY_ENABLED="false"
else
  NEXTAUTH_URL="https://${DOMAIN}"
  GATEWAY_WS_URL="wss://${DOMAIN}/socket"
  CADDY_ENABLED="true"
fi

# --- Write .env ---
GENERATED_AT=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
cat > .env <<EOF
# Tavok Configuration
# Generated by setup.sh on ${GENERATED_AT}
# Keep this file secret. Never commit it to git.

# ============================================================
# DOMAIN & URLs
# ============================================================

DOMAIN=${DOMAIN}
NEXTAUTH_URL=${NEXTAUTH_URL}
NEXT_PUBLIC_GATEWAY_URL=${GATEWAY_WS_URL}

# ============================================================
# DATABASE
# ============================================================

POSTGRES_USER=tavok
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=tavok
DATABASE_URL=postgresql://tavok:${POSTGRES_PASSWORD}@db:5432/tavok

# ============================================================
# REDIS
# ============================================================

REDIS_PASSWORD=${REDIS_PASSWORD}

# ============================================================
# SECRETS (auto-generated, do not share)
# ============================================================

NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
JWT_SECRET=${JWT_SECRET}
INTERNAL_API_SECRET=${INTERNAL_API_SECRET}
SECRET_KEY_BASE=${SECRET_KEY_BASE}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ============================================================
# SERVICE PORTS
# ============================================================

GATEWAY_PORT=4001
STREAMING_PORT=4002

# ============================================================
# ENVIRONMENT
# ============================================================

NODE_ENV=production
MIX_ENV=prod
EOF

echo ""
echo "✓ .env file created with secure secrets."
echo ""
if [ "$DOMAIN" != "localhost" ]; then
  echo "Next steps:"
  echo "  1. Point DNS for ${DOMAIN} to this server's IP"
  echo "  2. Run: docker compose --profile production up -d"
  echo "     (pulls pre-built images from ghcr.io — no build needed)"
  echo "  3. Open https://${DOMAIN}"
  echo ""
  echo "Caddy will automatically obtain an HTTPS certificate."
else
  echo "Next steps:"
  echo "  1. Run: docker compose up -d"
  echo "     (pulls pre-built images from ghcr.io — no build needed)"
  echo "  2. Open http://localhost:5555"
fi
echo ""
