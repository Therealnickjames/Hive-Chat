defmodule HiveGateway.MessagePersistence do
  @moduledoc """
  Background message persistence with retry logic.

  Persists messages via the Web API in a fire-and-forget Task.
  Messages are already broadcast to clients before this runs —
  persistence is the durable backup, not the gatekeeper.

  Retry strategy: exponential backoff, max 3 retries (4 total attempts).
  Backoff: 1s → 2s → 4s (7s worst case).
  409 Conflict treated as success (idempotency guard for retries).

  See docs/DECISIONS.md DEC-0028.
  """

  alias HiveGateway.WebClient

  require Logger

  @max_retries 3
  @base_delay_ms 1_000

  @doc """
  Persist a message with exponential backoff retry.

  Returns :ok on success (including 409 duplicate),
  or :permanent_failure after all retries exhausted.
  """
  def persist_with_retry(body, message_id, channel_id, attempt \\ 0) do
    case WebClient.post_message(body) do
      {:ok, _response} ->
        if attempt > 0 do
          Logger.info(
            "Message persisted on retry: message=#{message_id} channel=#{channel_id} attempt=#{attempt}"
          )
        end

        :ok

      {:error, {:http_error, 409, _body}} ->
        # Duplicate — already persisted (retry hit after previous success).
        Logger.debug(
          "Message already exists (409): message=#{message_id} channel=#{channel_id}"
        )

        :ok

      {:error, reason} when attempt < @max_retries ->
        delay = @base_delay_ms * Integer.pow(2, attempt)

        Logger.warning(
          "Message persist failed, retrying: message=#{message_id} channel=#{channel_id} " <>
            "attempt=#{attempt}/#{@max_retries} delay=#{delay}ms error=#{inspect(reason)}"
        )

        Process.sleep(delay)
        persist_with_retry(body, message_id, channel_id, attempt + 1)

      {:error, reason} ->
        Logger.critical(
          "Message persist permanently failed: message=#{message_id} channel=#{channel_id} " <>
            "attempts=#{attempt + 1} error=#{inspect(reason)}"
        )

        :permanent_failure
    end
  end

  @doc """
  Spawn a background task to persist a message.
  Returns the Task reference (for testing), but callers don't need to await it.
  """
  def persist_async(body, message_id, channel_id) do
    Task.Supervisor.async_nolink(HiveGateway.TaskSupervisor, fn ->
      persist_with_retry(body, message_id, channel_id)
    end)
  end
end
