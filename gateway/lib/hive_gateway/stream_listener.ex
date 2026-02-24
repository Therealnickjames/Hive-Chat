defmodule HiveGateway.StreamListener do
  @moduledoc """
  GenServer that subscribes to Redis pub/sub channels for streaming tokens
  and status updates, then broadcasts them to the appropriate Phoenix Channel rooms.

  Redis patterns:
  - hive:stream:tokens:{channelId}:{messageId} → broadcast stream_token to room:{channelId}
  - hive:stream:status:{channelId}:{messageId} → broadcast stream_complete or stream_error

  See docs/PROTOCOL.md §2 for payload contracts.
  """
  use GenServer

  require Logger

  # ---------- Public API ----------

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # ---------- GenServer callbacks ----------

  @impl true
  def init(_opts) do
    redis_url = Application.get_env(:hive_gateway, :redis_url, "redis://localhost:6379")

    # Start a dedicated Redix.PubSub connection (separate from the :redix command connection)
    case Redix.PubSub.start_link(redis_url, name: :redix_stream_pubsub) do
      {:ok, pubsub} ->
        # Subscribe to token and status patterns
        {:ok, _ref_tokens} =
          Redix.PubSub.psubscribe(pubsub, "hive:stream:tokens:*", self())

        {:ok, _ref_status} =
          Redix.PubSub.psubscribe(pubsub, "hive:stream:status:*", self())

        Logger.info("[StreamListener] Started — listening for stream tokens and status")
        {:ok, %{pubsub: pubsub}}

      {:error, reason} ->
        Logger.error("[StreamListener] Failed to connect to Redis: #{inspect(reason)}")
        {:stop, reason}
    end
  end

  @impl true
  def handle_info(
        {:redix_pubsub, _pubsub, _ref, :psubscribed, %{pattern: pattern}},
        state
      ) do
    Logger.info("[StreamListener] Subscribed to pattern: #{pattern}")
    {:noreply, state}
  end

  @impl true
  def handle_info(
        {:redix_pubsub, _pubsub, _ref, :pmessage,
         %{channel: channel, pattern: _pattern, payload: payload}},
        state
      ) do
    handle_stream_message(channel, payload)
    {:noreply, state}
  end

  @impl true
  def handle_info({:redix_pubsub, _pubsub, _ref, :disconnected, %{error: error}}, state) do
    Logger.warning("[StreamListener] Redis disconnected: #{inspect(error)}")
    {:noreply, state}
  end

  @impl true
  def handle_info({:redix_pubsub, _pubsub, _ref, :reconnected, _}, state) do
    Logger.info("[StreamListener] Redis reconnected")
    {:noreply, state}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("[StreamListener] Unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  # ---------- Private ----------

  defp handle_stream_message("hive:stream:tokens:" <> rest, payload) do
    # rest = "{channelId}:{messageId}"
    case String.split(rest, ":", parts: 2) do
      [channel_id, _message_id] ->
        case Jason.decode(payload) do
          {:ok, data} ->
            # Broadcast stream_token to room:{channelId}
            HiveGatewayWeb.Endpoint.broadcast!("room:#{channel_id}", "stream_token", data)

          {:error, _} ->
            Logger.error("[StreamListener] Failed to decode token payload: #{payload}")
        end

      _ ->
        Logger.error("[StreamListener] Invalid token channel format: hive:stream:tokens:#{rest}")
    end
  end

  defp handle_stream_message("hive:stream:status:" <> rest, payload) do
    # rest = "{channelId}:{messageId}"
    case String.split(rest, ":", parts: 2) do
      [channel_id, _message_id] ->
        case Jason.decode(payload) do
          {:ok, %{"status" => "complete"} = data} ->
            HiveGatewayWeb.Endpoint.broadcast!("room:#{channel_id}", "stream_complete", data)

          {:ok, %{"status" => "error"} = data} ->
            HiveGatewayWeb.Endpoint.broadcast!("room:#{channel_id}", "stream_error", data)

          {:ok, data} ->
            Logger.warning(
              "[StreamListener] Unknown stream status: #{inspect(Map.get(data, "status"))}"
            )

          {:error, _} ->
            Logger.error("[StreamListener] Failed to decode status payload: #{payload}")
        end

      _ ->
        Logger.error("[StreamListener] Invalid status channel format: hive:stream:status:#{rest}")
    end
  end

  defp handle_stream_message(channel, _payload) do
    Logger.warning("[StreamListener] Unhandled Redis channel: #{channel}")
  end
end
