defmodule TavokGateway.RateLimiterTest do
  use ExUnit.Case, async: false

  alias TavokGateway.RateLimiter

  setup do
    # Start or reuse the RateLimiter GenServer
    pid =
      case RateLimiter.start_link([]) do
        {:ok, pid} -> pid
        {:error, {:already_started, pid}} -> pid
      end

    # Reset counters before each test to ensure isolation
    send(pid, :reset)
    Process.sleep(10)

    on_exit(fn ->
      # Reset after test too
      if Process.alive?(pid), do: send(pid, :reset)
    end)

    :ok
  end

  describe "check_and_increment/1" do
    test "first message in a channel returns :ok" do
      assert RateLimiter.check_and_increment("channel-1") == :ok
    end

    test "messages under the limit all return :ok" do
      for _ <- 1..20 do
        assert RateLimiter.check_and_increment("channel-2") == :ok
      end
    end

    test "21st message in same second is rate limited" do
      for _ <- 1..20 do
        RateLimiter.check_and_increment("channel-3")
      end

      assert RateLimiter.check_and_increment("channel-3") == {:error, :rate_limited}
    end

    test "different channels have separate rate limits" do
      # Max out channel-A
      for _ <- 1..20 do
        RateLimiter.check_and_increment("channel-A")
      end

      assert RateLimiter.check_and_increment("channel-A") == {:error, :rate_limited}

      # channel-B should still be fine
      assert RateLimiter.check_and_increment("channel-B") == :ok
    end
  end

  describe "get_count/1" do
    test "returns 0 for unknown channel" do
      assert RateLimiter.get_count("never-used") == 0
    end

    test "returns correct count after increments" do
      RateLimiter.check_and_increment("channel-count")
      RateLimiter.check_and_increment("channel-count")
      RateLimiter.check_and_increment("channel-count")

      assert RateLimiter.get_count("channel-count") == 3
    end
  end

  describe "stats/0" do
    test "returns stats with expected keys" do
      stats = RateLimiter.stats()

      assert is_map(stats)
      assert Map.has_key?(stats, :active_channels)
      assert Map.has_key?(stats, :rejections)
      assert Map.has_key?(stats, :max_per_second)
      assert stats.max_per_second == 20
    end

    test "active_channels reflects distinct channels used" do
      RateLimiter.check_and_increment("stats-ch-1")
      RateLimiter.check_and_increment("stats-ch-2")

      stats = RateLimiter.stats()
      assert stats.active_channels >= 2
    end
  end

  describe "window reset" do
    test "counters reset after receiving :reset message" do
      # Send some messages
      for _ <- 1..5 do
        RateLimiter.check_and_increment("reset-test")
      end

      assert RateLimiter.get_count("reset-test") == 5

      # Simulate the reset timer firing
      send(Process.whereis(RateLimiter), :reset)

      # Give the GenServer time to process
      Process.sleep(10)

      assert RateLimiter.get_count("reset-test") == 0
    end
  end
end
