import Config

config :tavok_gateway, TavokGatewayWeb.Endpoint,
  cache_static_manifest: false,
  server: true

config :logger,
  level: :info,
  backends: [:console]

config :logger, :console,
  format: {TavokGateway.LogFormatter, :format},
  metadata: [:request_id, :user_id, :channel_id]
