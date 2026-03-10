defmodule TavokGateway.Application do
  @moduledoc """
  OTP Application for TavokGateway.

  Supervision tree:
  - Phoenix.PubSub (in-process pub/sub for Phoenix Channels)
  - Redix (Redis connection for cross-service pub/sub and sequence numbers)
  - TavokGateway.Presence (Phoenix Presence tracking)
  - TavokGatewayWeb.Endpoint (HTTP + WebSocket server)
  """
  use Application

  require Logger

  @impl true
  def start(_type, _args) do
    redis_url = Application.get_env(:tavok_gateway, :redis_url, "redis://localhost:6379")

    children = [
      # Phoenix PubSub — internal pub/sub for Channels
      {Phoenix.PubSub, name: TavokGateway.PubSub},

      # Redis connection — for cross-service communication
      {Redix, {redis_url, [name: :redix]}},

      # Task supervisor — for async agent trigger work (ISSUE-007)
      {Task.Supervisor, name: TavokGateway.TaskSupervisor},

      # Config cache — ETS-backed cache for agent config and membership (DEC-0029)
      TavokGateway.ConfigCache,

      # Message buffer — ETS-backed recent message cache for sync gap (DEC-0051)
      TavokGateway.MessageBuffer,

      # Rate limiter — per-channel message rate limiting (DEC-0035)
      TavokGateway.RateLimiter,

      # Presence tracking
      TavokGatewayWeb.Presence,

      # Stream watchdog — fallback terminal event recovery
      TavokGateway.StreamWatchdog,

      # Stream listener — Redis pub/sub → Phoenix Channel bridge
      TavokGateway.StreamListener,

      # HTTP + WebSocket endpoint
      TavokGatewayWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: TavokGateway.Supervisor]

    Logger.info("TavokGateway starting...")
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    TavokGatewayWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
