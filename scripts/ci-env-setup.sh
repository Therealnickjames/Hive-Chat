#!/bin/bash
# Generate .env for CI from .env.example
# Usage: cp .env.example .env && ./scripts/ci-env-setup.sh

set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run: cp .env.example .env first"
  exit 1
fi

# Generate deterministic but valid secrets for CI
# tr -d '\n' ensures no newlines in base64 output (which breaks sed)
NEXTAUTH_SECRET=$(openssl rand -base64 32 | tr -d '\n')
JWT_SECRET=$(openssl rand -base64 32 | tr -d '\n')
INTERNAL_API_SECRET=$(openssl rand -base64 32 | tr -d '\n')
SECRET_KEY_BASE=$(openssl rand -base64 64 | tr -d '\n')
ENCRYPTION_KEY=$(openssl rand -hex 32 | tr -d '\n')
REDIS_PASSWORD=$(openssl rand -base64 16 | tr -d '=+/\n' | head -c 20)

# Replace CHANGE-ME values
sed -i "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=$NEXTAUTH_SECRET|" "$ENV_FILE"
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" "$ENV_FILE"
sed -i "s|^INTERNAL_API_SECRET=.*|INTERNAL_API_SECRET=$INTERNAL_API_SECRET|" "$ENV_FILE"
sed -i "s|^SECRET_KEY_BASE=.*|SECRET_KEY_BASE=$SECRET_KEY_BASE|" "$ENV_FILE"
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" "$ENV_FILE"
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$REDIS_PASSWORD|" "$ENV_FILE"

echo "CI .env generated successfully"
