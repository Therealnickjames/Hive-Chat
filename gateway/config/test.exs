import Config

config :tavok_gateway, TavokGatewayWeb.Endpoint,
  server: false,
  check_origin: false,
  secret_key_base: "test-secret-key-base-that-is-at-least-64-bytes-long-for-tests-only"

config :logger, level: :warning
