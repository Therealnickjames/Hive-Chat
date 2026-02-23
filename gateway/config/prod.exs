import Config

config :hive_gateway, HiveGatewayWeb.Endpoint,
  cache_static_manifest: false,
  server: true

config :logger, level: :info,
  backends: [:console]

config :logger, :console,
  format: {Jason, :encode!},
  metadata: [:request_id, :user_id, :channel_id]
