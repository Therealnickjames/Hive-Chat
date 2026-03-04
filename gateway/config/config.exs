# General configuration for TavokGateway
import Config

config :tavok_gateway, TavokGatewayWeb.Endpoint,
  url: [host: "localhost"],
  render_errors: [formats: [json: TavokGatewayWeb.ErrorJSON]],
  pubsub_server: TavokGateway.PubSub

# JSON library
config :phoenix, :json_library, Jason

# Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Import environment-specific config
import_config "#{config_env()}.exs"
