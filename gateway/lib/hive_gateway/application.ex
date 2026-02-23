defmodule HiveGateway.Application do
  @moduledoc """
  OTP Application for HiveGateway.

  Supervision tree:
  - Phoenix.PubSub (in-process pub/sub for Phoenix Channels)
  - Redix (Redis connection for cross-service pub/sub and sequence numbers)
  - HiveGateway.Presence (Phoenix Presence tracking)
  - HiveGatewayWeb.Endpoint (HTTP + WebSocket server)
  """
  use Application

  require Logger

  @impl true
  def start(_type, _args) do
    redis_url = Application.get_env(:hive_gateway, :redis_url, "redis://localhost:6379")

    children = [
      # Phoenix PubSub — internal pub/sub for Channels
      {Phoenix.PubSub, name: HiveGateway.PubSub},

      # Redis connection — for cross-service communication
      {Redix, {redis_url, [name: :redix]}},

      # Presence tracking
      HiveGatewayWeb.Presence,

      # HTTP + WebSocket endpoint
      HiveGatewayWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: HiveGateway.Supervisor]

    Logger.info("HiveGateway starting...")
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    HiveGatewayWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
