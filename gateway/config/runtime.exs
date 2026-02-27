import Config

# Runtime configuration — reads from environment variables
# These are set via docker-compose.yml or .env

if config_env() == :prod do
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise "SECRET_KEY_BASE not set. Generate with: mix phx.gen.secret"

  config :hive_gateway, HiveGatewayWeb.Endpoint,
    adapter: Bandit.PhoenixAdapter,
    http: [
      ip: {0, 0, 0, 0},
      port: String.to_integer(System.get_env("GATEWAY_PORT") || "4001")
    ],
    secret_key_base: secret_key_base,
    check_origin: false
end

# JWT secret for validating tokens from Next.js (DEC-0003)
config :hive_gateway, :jwt_secret,
  System.get_env("GATEWAY_JWT_SECRET") || System.get_env("JWT_SECRET") || "dev-jwt-secret"

# Redis connection
config :hive_gateway, :redis_url,
  System.get_env("GATEWAY_REDIS_URL") || System.get_env("REDIS_URL") || "redis://localhost:6379"

# Next.js internal API URL
config :hive_gateway, :web_url,
  System.get_env("GATEWAY_WEB_URL") || "http://localhost:3000"

# Internal API secret
config :hive_gateway, :internal_api_secret,
  System.get_env("INTERNAL_API_SECRET") || "dev-internal-secret"

config :hive_gateway, :stream_watchdog_timeout_ms,
  String.to_integer(System.get_env("STREAM_WATCHDOG_TIMEOUT_MS") || "45000")
