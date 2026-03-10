defmodule TavokGateway.ConfigCache do
  @moduledoc """
  ETS-backed cache for channel agent config and membership checks.

  Eliminates per-message HTTP round-trips to Next.js for agent config lookups
  and reduces per-join HTTP calls for membership checks.

  Cache entries:
  - Agent config: key {:agent, channel_id}, TTL 5 minutes
  - Membership: key {:member, channel_id, user_id}, TTL 15 minutes

  Both "no agent" (nil) and positive results are cached to prevent repeated 404s.
  Errors are NOT cached — the next call retries.

  The ETS table is :public with read_concurrency: true so channel processes
  read directly without going through the GenServer mailbox.

  Request collapsing: on cache miss, concurrent callers for the same key are
  coalesced — only one HTTP request is made, and all waiters receive the result.
  This prevents thundering herd on cold cache or TTL expiry. (DEC-0031)

  See docs/DECISIONS.md DEC-0029, DEC-0031.
  """
  use GenServer

  alias TavokGateway.WebClient

  require Logger

  # ---------- Configuration ----------

  @table_name :hive_config_cache
  @agent_ttl_ms 5 * 60 * 1_000
  @membership_ttl_ms 15 * 60 * 1_000
  @sweep_interval_ms 60 * 1_000

  # ---------- Public API ----------

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Get agent config for a channel. Returns {:ok, agent_config | nil} or {:error, reason}.
  Fast path: reads directly from ETS (no GenServer mailbox hop on cache hit).
  Slow path: routes through GenServer for request collapsing on cache miss.
  """
  def get_channel_agent(channel_id) do
    key = {:agent, channel_id}

    case ets_lookup(key) do
      {:hit, value} ->
        GenServer.cast(__MODULE__, :hit)
        {:ok, value}

      :miss ->
        # Route through GenServer to coalesce concurrent misses for same key
        GenServer.call(__MODULE__, {:fetch_agent, channel_id}, 10_000)
    end
  end

  @doc """
  Get ALL agents for a channel (multi-agent — TASK-0012).
  Returns {:ok, [agent_config, ...]} or {:error, reason}.
  Fast path: reads directly from ETS. Slow path: request collapsing via GenServer.
  Separate cache key {:agents, channel_id} with same TTL as single-agent cache.
  """
  def get_channel_agents(channel_id) do
    key = {:agents, channel_id}

    case ets_lookup(key) do
      {:hit, value} ->
        GenServer.cast(__MODULE__, :hit)
        {:ok, value}

      :miss ->
        GenServer.call(__MODULE__, {:fetch_agents, channel_id}, 10_000)
    end
  end

  @doc """
  Check channel membership for a user. Returns {:ok, map} or {:error, reason}.
  Fast path: reads directly from ETS (no GenServer mailbox hop on cache hit).
  Slow path: routes through GenServer for request collapsing on cache miss.
  """
  def get_channel_membership(channel_id, user_id) do
    key = {:member, channel_id, user_id}

    case ets_lookup(key) do
      {:hit, value} ->
        GenServer.cast(__MODULE__, :hit)
        {:ok, value}

      :miss ->
        GenServer.call(__MODULE__, {:fetch_membership, channel_id, user_id}, 10_000)
    end
  end

  @doc "Invalidate cached agent config for a channel (single + multi-agent)."
  def invalidate_agent(channel_id) do
    try do
      :ets.delete(@table_name, {:agent, channel_id})
      :ets.delete(@table_name, {:agents, channel_id})
    rescue
      ArgumentError -> :ok
    end

    Logger.info("[ConfigCache] Invalidated agent cache: channel=#{channel_id}")
    :ok
  end

  @doc "Invalidate cached membership for a specific user+channel."
  def invalidate_membership(channel_id, user_id) do
    try do
      :ets.delete(@table_name, {:member, channel_id, user_id})
    rescue
      ArgumentError -> :ok
    end

    :ok
  end

  @doc "Invalidate all cached entries for a channel (agent + agents + all memberships)."
  def invalidate_channel(channel_id) do
    try do
      :ets.delete(@table_name, {:agent, channel_id})
      :ets.delete(@table_name, {:agents, channel_id})
      :ets.match_delete(@table_name, {{:member, channel_id, :_}, :_, :_})
    rescue
      ArgumentError -> :ok
    end

    Logger.info("[ConfigCache] Invalidated all cache entries: channel=#{channel_id}")
    :ok
  end

  @doc "Return cache statistics: hits, misses, coalesced count, and table size."
  def stats do
    GenServer.call(__MODULE__, :stats)
  end

  # ---------- GenServer callbacks ----------

  @impl true
  def init(_opts) do
    table =
      :ets.new(@table_name, [
        :named_table,
        :set,
        :public,
        read_concurrency: true
      ])

    schedule_sweep()

    Logger.info(
      "[ConfigCache] Started — agent_ttl=#{@agent_ttl_ms}ms membership_ttl=#{@membership_ttl_ms}ms"
    )

    {:ok, %{table: table, hits: 0, misses: 0, coalesced: 0, in_flight: %{}}}
  end

  @impl true
  def handle_cast(:hit, state) do
    {:noreply, %{state | hits: state.hits + 1}}
  end

  @impl true
  def handle_cast(:miss, state) do
    {:noreply, %{state | misses: state.misses + 1}}
  end

  # --- Request collapsing: agent config fetch ---

  @impl true
  def handle_call({:fetch_agent, channel_id}, from, state) do
    key = {:agent, channel_id}

    # Double-check ETS (may have been populated between caller's miss and this call)
    case ets_lookup(key) do
      {:hit, value} ->
        {:reply, {:ok, value}, %{state | hits: state.hits + 1}}

      :miss ->
        state = %{state | misses: state.misses + 1}

        case Map.get(state.in_flight, key) do
          nil ->
            # No in-flight request — start one
            task =
              Task.async(fn ->
                case WebClient.get_channel_agent(channel_id) do
                  {:ok, agent_config} ->
                    now = System.monotonic_time(:millisecond)
                    expires_at = now + @agent_ttl_ms
                    :ets.insert(@table_name, {key, agent_config, expires_at})
                    {:ok, agent_config}

                  {:error, _reason} = error ->
                    error
                end
              end)

            in_flight = Map.put(state.in_flight, key, {task.ref, [from]})
            {:noreply, %{state | in_flight: in_flight}}

          {_ref, waiters} ->
            # Request already in-flight — add caller to waiters list
            in_flight =
              Map.put(
                state.in_flight,
                key,
                {elem(Map.get(state.in_flight, key), 0), [from | waiters]}
              )

            {:noreply, %{state | coalesced: state.coalesced + 1, in_flight: in_flight}}
        end
    end
  end

  # --- Request collapsing: multi-agent fetch (TASK-0012) ---

  @impl true
  def handle_call({:fetch_agents, channel_id}, from, state) do
    key = {:agents, channel_id}

    case ets_lookup(key) do
      {:hit, value} ->
        {:reply, {:ok, value}, %{state | hits: state.hits + 1}}

      :miss ->
        state = %{state | misses: state.misses + 1}

        case Map.get(state.in_flight, key) do
          nil ->
            task =
              Task.async(fn ->
                case WebClient.get_channel_agents(channel_id) do
                  {:ok, agents} ->
                    now = System.monotonic_time(:millisecond)
                    expires_at = now + @agent_ttl_ms
                    :ets.insert(@table_name, {key, agents, expires_at})
                    {:ok, agents}

                  {:error, _reason} = error ->
                    error
                end
              end)

            in_flight = Map.put(state.in_flight, key, {task.ref, [from]})
            {:noreply, %{state | in_flight: in_flight}}

          {_ref, waiters} ->
            in_flight =
              Map.put(
                state.in_flight,
                key,
                {elem(Map.get(state.in_flight, key), 0), [from | waiters]}
              )

            {:noreply, %{state | coalesced: state.coalesced + 1, in_flight: in_flight}}
        end
    end
  end

  # --- Request collapsing: membership fetch ---

  @impl true
  def handle_call({:fetch_membership, channel_id, user_id}, from, state) do
    key = {:member, channel_id, user_id}

    case ets_lookup(key) do
      {:hit, value} ->
        {:reply, {:ok, value}, %{state | hits: state.hits + 1}}

      :miss ->
        state = %{state | misses: state.misses + 1}

        case Map.get(state.in_flight, key) do
          nil ->
            task =
              Task.async(fn ->
                case WebClient.check_channel_membership(channel_id, user_id) do
                  {:ok, membership_result} ->
                    now = System.monotonic_time(:millisecond)
                    expires_at = now + @membership_ttl_ms
                    :ets.insert(@table_name, {key, membership_result, expires_at})
                    {:ok, membership_result}

                  {:error, _reason} = error ->
                    error
                end
              end)

            in_flight = Map.put(state.in_flight, key, {task.ref, [from]})
            {:noreply, %{state | in_flight: in_flight}}

          {_ref, waiters} ->
            in_flight =
              Map.put(
                state.in_flight,
                key,
                {elem(Map.get(state.in_flight, key), 0), [from | waiters]}
              )

            {:noreply, %{state | coalesced: state.coalesced + 1, in_flight: in_flight}}
        end
    end
  end

  @impl true
  def handle_call(:stats, _from, state) do
    info = :ets.info(state.table)
    size = Keyword.get(info, :size, 0)

    {:reply,
     %{
       hits: state.hits,
       misses: state.misses,
       coalesced: state.coalesced,
       size: size,
       in_flight: map_size(state.in_flight)
     }, state}
  end

  # --- Task completion: reply to all waiters ---

  @impl true
  def handle_info({ref, result}, state) when is_reference(ref) do
    # Find which key this task belongs to
    case Enum.find(state.in_flight, fn {_key, {task_ref, _waiters}} -> task_ref == ref end) do
      {key, {^ref, waiters}} ->
        # Reply to all waiting callers
        Enum.each(waiters, fn from -> GenServer.reply(from, result) end)

        # Clean up the monitor (Task.async sets one)
        Process.demonitor(ref, [:flush])

        {:noreply, %{state | in_flight: Map.delete(state.in_flight, key)}}

      nil ->
        # Unknown ref — ignore (could be from a stale task)
        Process.demonitor(ref, [:flush])
        {:noreply, state}
    end
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    # Task crashed — reply with error to all waiters
    case Enum.find(state.in_flight, fn {_key, {task_ref, _waiters}} -> task_ref == ref end) do
      {key, {^ref, waiters}} ->
        error = {:error, {:task_crashed, reason}}
        Enum.each(waiters, fn from -> GenServer.reply(from, error) end)

        Logger.error(
          "[ConfigCache] In-flight fetch crashed: key=#{inspect(key)} reason=#{inspect(reason)}"
        )

        {:noreply, %{state | in_flight: Map.delete(state.in_flight, key)}}

      nil ->
        {:noreply, state}
    end
  end

  @impl true
  def handle_info(:sweep, state) do
    now = System.monotonic_time(:millisecond)

    expired =
      :ets.select(state.table, [
        {{:"$1", :_, :"$2"}, [{:"=<", :"$2", now}], [:"$1"]}
      ])

    Enum.each(expired, fn key -> :ets.delete(state.table, key) end)

    if length(expired) > 0 do
      Logger.debug("[ConfigCache] Swept #{length(expired)} expired entries")
    end

    schedule_sweep()
    {:noreply, state}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("[ConfigCache] Unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  # ---------- Private ----------

  defp ets_lookup(key) do
    now = System.monotonic_time(:millisecond)

    try do
      case :ets.lookup(@table_name, key) do
        [{^key, value, expires_at}] when expires_at > now -> {:hit, value}
        _ -> :miss
      end
    rescue
      ArgumentError -> :miss
    end
  end

  defp schedule_sweep do
    Process.send_after(self(), :sweep, @sweep_interval_ms)
  end
end
