import Config

# Runtime configuration — reads from environment variables
# These are set via docker-compose.yml or .env

if config_env() == :prod do
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise "SECRET_KEY_BASE not set. Generate with: mix phx.gen.secret"

  # ALLOWED_ORIGINS: comma-separated list of allowed WebSocket origins.
  # Default: allow localhost origins for development.
  # Production: set to your domain, e.g. "https://yourdomain.com"
  allowed_origins =
    case System.get_env("ALLOWED_ORIGINS") do
      nil -> ["//localhost", "//127.0.0.1"]
      origins -> String.split(origins, ",", trim: true)
    end

  config :tavok_gateway, TavokGatewayWeb.Endpoint,
    adapter: Bandit.PhoenixAdapter,
    http: [
      ip: {0, 0, 0, 0},
      port: String.to_integer(System.get_env("GATEWAY_PORT") || "4001")
    ],
    secret_key_base: secret_key_base,
    check_origin: allowed_origins
end

# JWT secret for validating tokens from Next.js (DEC-0003)
config :tavok_gateway,
       :jwt_secret,
       System.get_env("GATEWAY_JWT_SECRET") || System.get_env("JWT_SECRET") ||
         raise("GATEWAY_JWT_SECRET or JWT_SECRET must be set")

# Redis connection
config :tavok_gateway,
       :redis_url,
       System.get_env("GATEWAY_REDIS_URL") || System.get_env("REDIS_URL") ||
         "redis://localhost:6379"

# Next.js internal API URL
config :tavok_gateway, :web_url, System.get_env("GATEWAY_WEB_URL") || "http://localhost:3000"

# Internal API secret
config :tavok_gateway,
       :internal_api_secret,
       System.get_env("INTERNAL_API_SECRET") ||
         raise("INTERNAL_API_SECRET must be set")

config :tavok_gateway,
       :stream_watchdog_timeout_ms,
       String.to_integer(System.get_env("STREAM_WATCHDOG_TIMEOUT_MS") || "45000")
