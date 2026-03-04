defmodule TavokGateway.MessageBuffer do
  @moduledoc """
  ETS-backed recent message buffer for reconnection sync.

  Solves the broadcast-first/async-persistence gap (DEC-0028):
  messages are broadcast immediately but persisted asynchronously.
  When a client reconnects, sync_on_join queries the DB, which may
  not yet contain recently broadcast messages. This buffer keeps
  the last 60 seconds of messages in ETS so sync_on_join can merge
  buffered messages with DB results.

  Uses the same GenServer + ETS pattern as RateLimiter and ConfigCache.
  ETS table is :public with read_concurrency for lock-free reads from
  channel processes.

  See docs/DECISIONS.md DEC-0051.
  """
  use GenServer

  require Logger

  # ---------- Configuration ----------

  @table_name :hive_message_buffer
  @ttl_ms 60_000
  @sweep_interval_ms 30_000

  # ---------- Public API ----------

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Buffer a message after broadcast.
  Called from room_channel.ex handle_in("new_message", ...) right after broadcast.
  The message_map must include :id, :channelId, :sequence, and all broadcast fields.
  """
  def buffer_message(channel_id, message_map) when is_binary(channel_id) and is_map(message_map) do
    now = System.monotonic_time(:millisecond)
    message_id = Map.get(message_map, :id) || Map.get(message_map, "id")
    sequence = Map.get(message_map, :sequence) || Map.get(message_map, "sequence")

    try do
      :ets.insert(@table_name, {
        {channel_id, message_id},
        sequence,
        message_map,
        now
      })
    rescue
      ArgumentError -> :ok
    end
  end

  @doc """
  Get buffered messages for a channel with sequence > after_sequence.
  Returns a list of message maps, sorted by sequence ascending.
  Called from sync_on_join to supplement DB query results.
  """
  def get_messages_after(channel_id, after_sequence) when is_binary(channel_id) do
    after_seq_int = parse_sequence_int(after_sequence)

    try do
      # Match all entries for this channel_id
      # ETS key is {channel_id, message_id}, so we use match_object
      entries = :ets.match_object(@table_name, {{channel_id, :_}, :_, :_, :_})

      entries
      |> Enum.filter(fn {_key, seq_str, _msg, _inserted} ->
        parse_sequence_int(seq_str) > after_seq_int
      end)
      |> Enum.sort_by(fn {_key, seq_str, _msg, _inserted} ->
        parse_sequence_int(seq_str)
      end)
      |> Enum.map(fn {_key, _seq, msg, _inserted} -> msg end)
    rescue
      ArgumentError -> []
    end
  end

  @doc "Return buffer statistics."
  def stats do
    GenServer.call(__MODULE__, :stats)
  end

  # ---------- GenServer callbacks ----------

  @impl true
  def init(_opts) do
    :ets.new(@table_name, [
      :named_table,
      :set,
      :public,
      read_concurrency: true,
      write_concurrency: true
    ])

    schedule_sweep()

    Logger.info(
      "[MessageBuffer] Started — ttl=#{@ttl_ms}ms sweep_interval=#{@sweep_interval_ms}ms"
    )

    {:ok, %{swept: 0}}
  end

  @impl true
  def handle_call(:stats, _from, state) do
    info = :ets.info(@table_name)
    size = Keyword.get(info, :size, 0)

    {:reply, %{buffered_messages: size, swept: state.swept}, state}
  end

  @impl true
  def handle_info(:sweep, state) do
    now = System.monotonic_time(:millisecond)
    cutoff = now - @ttl_ms

    # Select keys where inserted_at < cutoff
    expired_keys =
      :ets.select(@table_name, [
        {{:"$1", :_, :_, :"$2"}, [{:<, :"$2", cutoff}], [:"$1"]}
      ])

    Enum.each(expired_keys, fn key -> :ets.delete(@table_name, key) end)

    swept = length(expired_keys)

    if swept > 0 do
      Logger.debug("[MessageBuffer] Swept #{swept} expired entries")
    end

    schedule_sweep()
    {:noreply, %{state | swept: state.swept + swept}}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("[MessageBuffer] Unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  # ---------- Private ----------

  defp schedule_sweep do
    Process.send_after(self(), :sweep, @sweep_interval_ms)
  end

  defp parse_sequence_int(nil), do: 0
  defp parse_sequence_int(val) when is_integer(val), do: val

  defp parse_sequence_int(val) when is_binary(val) do
    case Integer.parse(val) do
      {num, ""} -> num
      _ -> 0
    end
  end

  defp parse_sequence_int(_), do: 0
end
