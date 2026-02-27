# Multi-stage Dockerfile for Elixir/Phoenix Gateway
# Stage 1: Install dependencies and compile
# Stage 2: Build release
# Stage 3: Minimal runtime

# --- Stage 1: Build ---
FROM elixir:1.17-alpine AS builder

RUN apk add --no-cache build-base git

WORKDIR /app

# Install hex and rebar
RUN mix local.hex --force && \
    mix local.rebar --force

# Set build env
ENV MIX_ENV=prod

# Copy dependency files first (for Docker layer caching)
COPY mix.exs mix.lock* ./
RUN mix deps.get --only prod
RUN mix deps.compile

# Copy source
COPY config/ config/
COPY lib/ lib/

# Compile application
RUN mix compile

# Build release
RUN mix release

# --- Stage 2: Runtime ---
# Must match Alpine version from elixir:1.17-alpine (3.22) for OpenSSL compatibility
FROM alpine:3.22 AS runner

RUN apk add --no-cache libstdc++ openssl ncurses-libs curl

WORKDIR /app

# Create non-root user
RUN addgroup -S elixir && adduser -S elixir -G elixir
USER elixir

# Copy release from builder
COPY --from=builder --chown=elixir:elixir /app/_build/prod/rel/hive_gateway ./

ENV HOME=/app
ENV MIX_ENV=prod
ENV PHX_SERVER=true

EXPOSE 4001

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:4001/api/health || exit 1

CMD ["bin/hive_gateway", "start"]
