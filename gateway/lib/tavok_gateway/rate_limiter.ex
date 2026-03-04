defmodule TavokGateway.RateLimiter do
  @moduledoc """
  Per-channel message rate limiter using ETS counters.

  Implements a sliding-window counter that resets every second.
  Each channel gets a counter tracking messages in the current window.
  When a channel exceeds the limit, new messages are rejected until
  the window resets.

  Uses ETS with :public + write_concurrency for lock-free atomic increments
  from channel processes — no GenServer mailbox bottleneck.

  See docs/DECISIONS.md DEC-0035.
  """
  use GenServer

  require Logger

  # ---------- Configuration ----------

  @table_name :hive_rate_limiter
  @max_messages_per_second 20
  @reset_interval_ms 1_000

  # ---------- Public API ----------

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Check if a message can be sent in the given channel.
  Returns :ok if under the rate limit, {:error, :rate_limited} if over.
  Atomically increments the counter.
  """
  def check_and_increment(channel_id) do
    try do
      count = :ets.update_counter(@table_name, channel_id, {2, 1}, {channel_id, 0})

      if count <= @max_messages_per_second do
        :ok
      else
        {:error, :rate_limited}
      end
    rescue
      ArgumentError ->
        # Table not yet created (shouldn't happen after init)
        :ok
    end
  end

  @doc "Return the current message count for a channel (for debugging)."
  def get_count(channel_id) do
    try do
      case :ets.lookup(@table_name, channel_id) do
        [{^channel_id, count}] -> count
        [] -> 0
      end
    rescue
      ArgumentError -> 0
    end
  end

  @doc "Return rate limiter statistics."
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
      write_concurrency: true
    ])

    schedule_reset()

    Logger.info(
      "[RateLimiter] Started — max_messages_per_second=#{@max_messages_per_second}"
    )

    {:ok, %{rejections: 0}}
  end

  @impl true
  def handle_call(:stats, _from, state) do
    info = :ets.info(@table_name)
    size = Keyword.get(info, :size, 0)

    {:reply,
     %{
       active_channels: size,
       rejections: state.rejections,
       max_per_second: @max_messages_per_second
     }, state}
  end

  @impl true
  def handle_info(:reset, state) do
    # Clear all counters — new window starts
    :ets.delete_all_objects(@table_name)
    schedule_reset()
    {:noreply, state}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("[RateLimiter] Unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  defp schedule_reset do
    Process.send_after(self(), :reset, @reset_interval_ms)
  end
end
