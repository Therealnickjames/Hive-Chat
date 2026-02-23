# General configuration for HiveGateway
import Config

config :hive_gateway, HiveGatewayWeb.Endpoint,
  url: [host: "localhost"],
  render_errors: [formats: [json: HiveGatewayWeb.ErrorJSON]],
  pubsub_server: HiveGateway.PubSub

# JSON library
config :phoenix, :json_library, Jason

# Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Import environment-specific config
import_config "#{config_env()}.exs"
