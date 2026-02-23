# Multi-stage Dockerfile for Go Streaming Proxy
# Stage 1: Build the binary
# Stage 2: Minimal runtime (distroless)

# --- Stage 1: Build ---
FROM golang:1.23-alpine AS builder

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy dependency files first (for Docker layer caching)
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /streaming ./cmd/proxy

# --- Stage 2: Runtime ---
FROM alpine:3.20

RUN apk add --no-cache ca-certificates curl

# Create non-root user
RUN addgroup -S streaming && adduser -S streaming -G streaming
USER streaming

WORKDIR /app
COPY --from=builder /streaming ./streaming

EXPOSE 4002

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -sf http://localhost:4002/health || exit 1

CMD ["./streaming"]
