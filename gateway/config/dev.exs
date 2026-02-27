import Config

config :hive_gateway, HiveGatewayWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: 4001],
  check_origin: false,
  debug_errors: true,
  secret_key_base: "dev-secret-key-base-that-is-at-least-64-bytes-long-for-development-only-not-production",
  server: true

config :logger, level: :debug
