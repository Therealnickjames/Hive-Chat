defmodule HiveGateway.StreamWatchdogTest do
  use ExUnit.Case, async: false

  alias HiveGateway.StreamWatchdog

  defmodule WebClientStub do
    def get_message(message_id) do
      Agent.get(:stream_watchdog_test_state, fn state ->
        Map.get(state, message_id, {:error, :not_found})
      end)
    end
  end

  setup do
    {:ok, _agent} =
      start_supervised(
        {Agent, fn -> %{} end, name: :stream_watchdog_test_state}
      )

    server = :"stream_watchdog_test_#{System.unique_integer([:positive])}"
    test_pid = self()

    broadcaster = fn topic, event, payload ->
      send(test_pid, {:broadcast, topic, event, payload})
      :ok
    end

    {:ok, _pid} =
      start_supervised(
        {StreamWatchdog,
         name: server,
         check_after_ms: 20,
         web_client: WebClientStub,
         broadcaster: broadcaster}
      )

    {:ok, server: server}
  end

  test "emits synthetic stream_complete when DB is COMPLETE", %{server: server} do
    put_message("message-complete", %{
      "id" => "message-complete",
      "streamingStatus" => "COMPLETE",
      "content" => "final answer"
    })

    StreamWatchdog.register_stream("channel-a", "message-complete", server)

    assert_receive {:broadcast, "room:channel-a", "stream_complete", payload}, 300
    assert payload["messageId"] == "message-complete"
    assert payload["status"] == "complete"
    assert payload["finalContent"] == "final answer"
  end

  test "emits synthetic stream_error when DB is ERROR", %{server: server} do
    put_message("message-error", %{
      "id" => "message-error",
      "streamingStatus" => "ERROR",
      "content" => "partial output"
    })

    StreamWatchdog.register_stream("channel-b", "message-error", server)

    assert_receive {:broadcast, "room:channel-b", "stream_error", payload}, 300
    assert payload["messageId"] == "message-error"
    assert payload["status"] == "error"
    assert payload["partialContent"] == "partial output"
  end

  test "retries while message is ACTIVE and completes later", %{server: server} do
    put_message("message-active", %{
      "id" => "message-active",
      "streamingStatus" => "ACTIVE",
      "content" => ""
    })

    StreamWatchdog.register_stream("channel-c", "message-active", server)
    refute_receive {:broadcast, "room:channel-c", "stream_complete", _payload}, 80

    put_message("message-active", %{
      "id" => "message-active",
      "streamingStatus" => "COMPLETE",
      "content" => "done later"
    })

    assert_receive {:broadcast, "room:channel-c", "stream_complete", payload}, 300
    assert payload["messageId"] == "message-active"
    assert payload["finalContent"] == "done later"
  end

  test "deregistered streams do not emit fallback events", %{server: server} do
    put_message("message-deregistered", %{
      "id" => "message-deregistered",
      "streamingStatus" => "ERROR",
      "content" => "partial"
    })

    StreamWatchdog.register_stream("channel-d", "message-deregistered", server)
    StreamWatchdog.deregister_stream("message-deregistered", server)

    refute_receive {:broadcast, "room:channel-d", "stream_error", _payload}, 120
  end

  defp put_message(message_id, message) do
    Agent.update(:stream_watchdog_test_state, fn state ->
      Map.put(state, message_id, {:ok, message})
    end)
  end
end
