defmodule TavokGateway.StreamWatchdog do
  @moduledoc """
  Fallback watchdog for terminal stream events.

  Redis pub/sub is best-effort. If a terminal stream status is missed during a
  transient subscriber disconnect window, this watchdog polls persisted message
  state and emits a synthetic terminal event to the room.
  """
  use GenServer

  require Logger

  @default_check_after_ms 45_000
  @max_active_retries 5

  # ---------- Public API ----------

  def start_link(opts) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  def register_stream(channel_id, message_id, server \\ __MODULE__)
      when is_binary(channel_id) and is_binary(message_id) do
    GenServer.cast(server, {:register, channel_id, message_id})
  end

  def deregister_stream(message_id, server \\ __MODULE__) when is_binary(message_id) do
    GenServer.cast(server, {:deregister, message_id})
  end

  # ---------- GenServer callbacks ----------

  @impl true
  def init(opts) do
    configured_check_after =
      Application.get_env(:tavok_gateway, :stream_watchdog_timeout_ms, @default_check_after_ms)

    check_after_ms = Keyword.get(opts, :check_after_ms, configured_check_after)
    web_client = Keyword.get(opts, :web_client, TavokGateway.WebClient)
    broadcaster = Keyword.get(opts, :broadcaster, &TavokGatewayWeb.Endpoint.broadcast/3)

    Logger.info("[StreamWatchdog] Started with timeout #{check_after_ms}ms")

    {:ok,
     %{
       active: %{},
       check_after_ms: check_after_ms,
       web_client: web_client,
       broadcaster: broadcaster
     }}
  end

  @impl true
  def handle_cast({:register, channel_id, message_id}, state) do
    active =
      state.active
      |> maybe_cancel_existing(message_id)
      |> Map.put(
        message_id,
        schedule_check(%{channel_id: channel_id, retries: 0}, message_id, state.check_after_ms)
      )

    {:noreply, %{state | active: active}}
  end

  @impl true
  def handle_cast({:deregister, message_id}, state) do
    {entry, active} = Map.pop(state.active, message_id)
    maybe_cancel_timer(entry)
    {:noreply, %{state | active: active}}
  end

  @impl true
  def handle_info({:check_stream, message_id, check_ref}, state) do
    case Map.get(state.active, message_id) do
      %{check_ref: ^check_ref} = entry ->
        retries = Map.get(entry, :retries, 0)

        case check_and_emit_terminal(entry.channel_id, message_id, retries, state) do
          :terminal ->
            {:noreply, %{state | active: Map.delete(state.active, message_id)}}

          :pending ->
            updated_entry = Map.put(entry, :retries, retries + 1)
            refreshed = schedule_check(updated_entry, message_id, state.check_after_ms)
            {:noreply, %{state | active: Map.put(state.active, message_id, refreshed)}}
        end

      _ ->
        # Stale timer or already deregistered.
        {:noreply, state}
    end
  end

  # ---------- Private ----------

  defp maybe_cancel_existing(active, message_id) do
    maybe_cancel_timer(Map.get(active, message_id))
    active
  end

  defp maybe_cancel_timer(nil), do: :ok
  defp maybe_cancel_timer(%{timer_ref: timer_ref}), do: Process.cancel_timer(timer_ref)

  defp schedule_check(entry, message_id, check_after_ms) do
    check_ref = make_ref()
    timer_ref = Process.send_after(self(), {:check_stream, message_id, check_ref}, check_after_ms)

    Map.merge(entry, %{
      check_ref: check_ref,
      timer_ref: timer_ref
    })
  end

  defp check_and_emit_terminal(channel_id, message_id, retries, state) do
    case state.web_client.get_message(message_id) do
      {:ok, %{"streamingStatus" => "COMPLETE"} = message} ->
        payload = %{
          "messageId" => message_id,
          "status" => "complete",
          "finalContent" => Map.get(message, "content") || ""
        }

        state.broadcaster.("room:#{channel_id}", "stream_complete", payload)
        Logger.info("[StreamWatchdog] Broadcast synthetic stream_complete: channel=#{channel_id} messageId=#{message_id}")
        :terminal

      {:ok, %{"streamingStatus" => "ERROR"} = message} ->
        partial_content = Map.get(message, "content")

        payload = %{
          "messageId" => message_id,
          "status" => "error",
          "error" => "Stream failed before terminal event delivery",
          "partialContent" => partial_content
        }

        state.broadcaster.("room:#{channel_id}", "stream_error", payload)
        Logger.info("[StreamWatchdog] Broadcast synthetic stream_error: channel=#{channel_id} messageId=#{message_id}")
        :terminal

      {:ok, %{"streamingStatus" => "ACTIVE"}} when retries >= @max_active_retries ->
        # Stream has been ACTIVE for too long — force-terminate.
        # This catches: Go Proxy died, web was down during finalize, or any other
        # scenario where the DB was never updated to a terminal state.
        Logger.error(
          "[StreamWatchdog] Forcing stuck stream to ERROR after #{retries} retries: " <>
            "channel=#{channel_id} messageId=#{message_id}"
        )

        update_result =
          state.web_client.update_message(message_id, %{
            "content" => "[Error: Stream timed out — no completion received]",
            "streamingStatus" => "ERROR"
          })

        case update_result do
          {:ok, _} ->
            Logger.info("[StreamWatchdog] Forced DB status to ERROR: messageId=#{message_id}")

          {:error, reason} ->
            Logger.error(
              "[StreamWatchdog] Failed to force DB status: messageId=#{message_id} reason=#{inspect(reason)}"
            )
        end

        payload = %{
          "messageId" => message_id,
          "status" => "error",
          "error" => "Stream timed out — no completion received",
          "partialContent" => nil
        }

        state.broadcaster.("room:#{channel_id}", "stream_error", payload)
        :terminal

      {:ok, %{"streamingStatus" => "ACTIVE"}} ->
        # Still active, but haven't hit max retries yet. Keep checking.
        :pending

      {:ok, %{"streamingStatus" => status}} ->
        Logger.warning(
          "[StreamWatchdog] Message has unknown streamingStatus, retrying: messageId=#{message_id} status=#{inspect(status)}"
        )

        :pending

      {:ok, _message} ->
        :pending

      {:error, reason} ->
        Logger.warning(
          "[StreamWatchdog] Failed to fetch message status, retrying: messageId=#{message_id} reason=#{inspect(reason)}"
        )

        :pending
    end
  end
end
