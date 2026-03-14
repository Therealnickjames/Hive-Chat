defmodule TavokGateway.Sequence do
  @moduledoc """
  Shared channel sequence generation for Gateway-owned message producers.

  WebSocket and non-WebSocket adapters must use the same Redis-backed sequence
  contract so reconnect sync and ordering remain monotonic across transports.
  """

  alias TavokGateway.WebClient

  @redis_retry_attempts 3
  @redis_retry_base_ms 100

  def next_channel_sequence(channel_id, opts \\ []) when is_binary(channel_id) do
    try do
      redis_client = Keyword.get(opts, :redis_client, redis_client())
      web_client = Keyword.get(opts, :web_client, web_client())
      sleep_fn = Keyword.get(opts, :sleep_fn, &Process.sleep/1)

      key = "hive:channel:#{channel_id}:seq"

      seed =
        case channel_seed_sequence(channel_id, web_client) do
          {:ok, value} -> value
          {:error, reason} -> throw({:sequence_seed_error, reason})
        end

      case redis_with_retry(redis_client, allocate_sequence_command(key, seed), sleep_fn) do
        {:ok, sequence} ->
          {:ok, sequence}

        {:error, reason} ->
          {:error, reason}
      end
    catch
      {:sequence_seed_error, reason} -> {:error, reason}
    end
  end

  defp redis_with_retry(redis_client, command, sleep_fn, attempt \\ 0) do
    case redis_client.command(:redix, command) do
      {:ok, result} ->
        {:ok, result}

      {:error, _reason} when attempt < @redis_retry_attempts ->
        delay = @redis_retry_base_ms * Integer.pow(2, attempt)
        sleep_fn.(delay)
        redis_with_retry(redis_client, command, sleep_fn, attempt + 1)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp allocate_sequence_command(key, seed) do
    [
      "EVAL",
      """
      local current = redis.call("GET", KEYS[1])
      local current_num = tonumber(current or "0")
      local seed_num = tonumber(ARGV[1] or "0")

      if current_num < seed_num then
        redis.call("SET", KEYS[1], seed_num)
      end

      return redis.call("INCR", KEYS[1])
      """,
      "1",
      key,
      Integer.to_string(seed)
    ]
  end

  defp channel_seed_sequence(channel_id, web_client) do
    case web_client.get_channel_info(channel_id) do
      {:ok, %{"lastSequence" => last_sequence}} ->
        normalize_sequence(last_sequence)

      {:ok, _} ->
        {:ok, 0}

      {:error, _reason} ->
        {:error, :channel_seed_failed}
    end
  end

  defp normalize_sequence(nil), do: {:ok, 0}

  defp normalize_sequence(value) when is_integer(value) do
    {:ok, max(value, 0)}
  end

  defp normalize_sequence(value) when is_binary(value) do
    case Integer.parse(value) do
      {num, ""} -> {:ok, max(num, 0)}
      _ -> {:error, :invalid_sequence}
    end
  end

  defp normalize_sequence(value) when is_float(value) do
    {:ok, max(round(value), 0)}
  end

  defp normalize_sequence(_), do: {:error, :invalid_sequence}

  defp redis_client do
    Application.get_env(:tavok_gateway, :redis_client, Redix)
  end

  defp web_client do
    Application.get_env(:tavok_gateway, :web_client, WebClient)
  end
end
