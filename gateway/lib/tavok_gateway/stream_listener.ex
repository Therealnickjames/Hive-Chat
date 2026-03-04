defmodule TavokGateway.StreamListener do
  @moduledoc """
  GenServer that subscribes to Redis pub/sub channels for streaming tokens
  and status updates, then broadcasts them to the appropriate Phoenix Channel rooms.

  Redis patterns:
  - hive:stream:tokens:{channelId}:{messageId} → broadcast stream_token to room:{channelId}
  - hive:stream:status:{channelId}:{messageId} → broadcast stream_complete or stream_error

  See docs/PROTOCOL.md §2 for payload contracts.
  """
  use GenServer

  alias TavokGateway.Broadcast

  require Logger

  # ---------- Public API ----------

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # ---------- GenServer callbacks ----------

  @impl true
  def init(_opts) do
    redis_url = Application.get_env(:tavok_gateway, :redis_url, "redis://localhost:6379")

    # Start a dedicated Redix.PubSub connection (separate from the :redix command connection)
    case Redix.PubSub.start_link(redis_url, name: :redix_stream_pubsub) do
      {:ok, pubsub} ->
        # Subscribe to token and status patterns
        {:ok, _ref_tokens} =
          Redix.PubSub.psubscribe(pubsub, "hive:stream:tokens:*", self())

        {:ok, _ref_status} =
          Redix.PubSub.psubscribe(pubsub, "hive:stream:status:*", self())

        {:ok, _ref_thinking} =
          Redix.PubSub.psubscribe(pubsub, "hive:stream:thinking:*", self())

        # TASK-0018: Tool call and result events
        {:ok, _ref_tool_call} =
          Redix.PubSub.psubscribe(pubsub, "hive:stream:tool_call:*", self())

        {:ok, _ref_tool_result} =
          Redix.PubSub.psubscribe(pubsub, "hive:stream:tool_result:*", self())

        # TASK-0021: Checkpoint events for stream rewind
        {:ok, _ref_checkpoint} =
          Redix.PubSub.psubscribe(pubsub, "hive:stream:checkpoint:*", self())

        # TASK-0020: Charter status events
        {:ok, _ref_charter} =
          Redix.PubSub.psubscribe(pubsub, "hive:stream:charter_status:*", self())

        Logger.info(
          "[StreamListener] Started — listening for stream tokens, status, thinking, tool_call, tool_result, checkpoint, charter_status"
        )

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
    # Redix.PubSub auto-resubscribes on reconnect, but explicitly re-subscribe
    # as a safety measure in case auto-resubscription fails silently. (ISSUE-025)
    Logger.info("[StreamListener] Redis reconnected — re-subscribing to patterns")

    {:ok, _ref_tokens} =
      Redix.PubSub.psubscribe(state.pubsub, "hive:stream:tokens:*", self())

    {:ok, _ref_status} =
      Redix.PubSub.psubscribe(state.pubsub, "hive:stream:status:*", self())

    {:ok, _ref_thinking} =
      Redix.PubSub.psubscribe(state.pubsub, "hive:stream:thinking:*", self())

    # TASK-0018: Re-subscribe to tool events
    {:ok, _ref_tool_call} =
      Redix.PubSub.psubscribe(state.pubsub, "hive:stream:tool_call:*", self())

    {:ok, _ref_tool_result} =
      Redix.PubSub.psubscribe(state.pubsub, "hive:stream:tool_result:*", self())

    # TASK-0021: Re-subscribe to checkpoint events
    {:ok, _ref_checkpoint} =
      Redix.PubSub.psubscribe(state.pubsub, "hive:stream:checkpoint:*", self())

    # TASK-0020: Re-subscribe to charter status events
    {:ok, _ref_charter} =
      Redix.PubSub.psubscribe(state.pubsub, "hive:stream:charter_status:*", self())

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
    # Zero-copy: payload is already valid JSON from Go Proxy — skip decode,
    # wrap raw bytes as Jason.Fragment to avoid 1000x re-encode. (DEC-0030)
    case String.split(rest, ":", parts: 2) do
      [channel_id, _message_id] ->
        Broadcast.endpoint_broadcast_raw!("room:#{channel_id}", "stream_token", payload)

      _ ->
        Logger.error("[StreamListener] Invalid token channel format: hive:stream:tokens:#{rest}")
    end
  end

  defp handle_stream_message("hive:stream:status:" <> rest, payload) do
    # rest = "{channelId}:{messageId}"
    # Decode to check status field, but broadcast raw JSON bytes. (DEC-0030)
    case String.split(rest, ":", parts: 2) do
      [channel_id, _message_id] ->
        case Jason.decode(payload) do
          {:ok, %{"status" => "complete"} = data} ->
            Broadcast.endpoint_broadcast_raw!("room:#{channel_id}", "stream_complete", payload)

            Logger.info(
              "[StreamListener] Broadcast stream_complete: channel=#{channel_id} messageId=#{Map.get(data, "messageId")}"
            )

          {:ok, %{"status" => "error"} = data} ->
            Broadcast.endpoint_broadcast_raw!("room:#{channel_id}", "stream_error", payload)

            Logger.info(
              "[StreamListener] Broadcast stream_error: channel=#{channel_id} messageId=#{Map.get(data, "messageId")}"
            )

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

  defp handle_stream_message("hive:stream:thinking:" <> rest, payload) do
    # rest = "{channelId}:{messageId}"
    # Zero-copy: payload is already valid JSON from Go Proxy — broadcast raw. (DEC-0030)
    case String.split(rest, ":", parts: 2) do
      [channel_id, _message_id] ->
        Broadcast.endpoint_broadcast_raw!("room:#{channel_id}", "stream_thinking", payload)

      _ ->
        Logger.error(
          "[StreamListener] Invalid thinking channel format: hive:stream:thinking:#{rest}"
        )
    end
  end

  # TASK-0018: Tool call events — broadcast to room for UI display
  defp handle_stream_message("hive:stream:tool_call:" <> rest, payload) do
    case String.split(rest, ":", parts: 2) do
      [channel_id, _message_id] ->
        Broadcast.endpoint_broadcast_raw!("room:#{channel_id}", "stream_tool_call", payload)

      _ ->
        Logger.error(
          "[StreamListener] Invalid tool_call channel format: hive:stream:tool_call:#{rest}"
        )
    end
  end

  # TASK-0018: Tool result events — broadcast to room for UI display
  defp handle_stream_message("hive:stream:tool_result:" <> rest, payload) do
    case String.split(rest, ":", parts: 2) do
      [channel_id, _message_id] ->
        Broadcast.endpoint_broadcast_raw!("room:#{channel_id}", "stream_tool_result", payload)

      _ ->
        Logger.error(
          "[StreamListener] Invalid tool_result channel format: hive:stream:tool_result:#{rest}"
        )
    end
  end

  # TASK-0021: Checkpoint events — broadcast to room for rewind UI
  defp handle_stream_message("hive:stream:checkpoint:" <> rest, payload) do
    case String.split(rest, ":", parts: 2) do
      [channel_id, _message_id] ->
        Broadcast.endpoint_broadcast_raw!("room:#{channel_id}", "stream_checkpoint", payload)

      _ ->
        Logger.error(
          "[StreamListener] Invalid checkpoint channel format: hive:stream:checkpoint:#{rest}"
        )
    end
  end

  # TASK-0020: Charter status events — broadcast to room for live header updates
  defp handle_stream_message("hive:stream:charter_status:" <> channel_id, payload) do
    Broadcast.endpoint_broadcast_raw!("room:#{channel_id}", "charter_status", payload)
  end

  defp handle_stream_message(channel, _payload) do
    Logger.warning("[StreamListener] Unhandled Redis channel: #{channel}")
  end
end
