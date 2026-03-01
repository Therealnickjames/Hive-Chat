defmodule HiveGateway.StreamWatchdogTest do
  use ExUnit.Case, async: false

  alias HiveGateway.StreamWatchdog

  defmodule WebClientStub do
    def get_message(message_id) do
      Agent.get(:stream_watchdog_test_state, fn state ->
        state
        |> Map.get(:messages, %{})
        |> Map.get(message_id, {:error, :not_found})
      end)
    end

    def update_message(message_id, update_body) do
      Agent.get_and_update(:stream_watchdog_test_state, fn state ->
        update_call = %{message_id: message_id, body: update_body}
        update_calls = [update_call | Map.get(state, :update_calls, [])]
        result = Map.get(state, :update_result, {:ok, %{}})

        {result, Map.put(state, :update_calls, update_calls)}
      end)
    end
  end

  setup do
    {:ok, _agent} =
      start_supervised(%{
        id: :stream_watchdog_test_state,
        start:
          {Agent, :start_link,
           [
             fn ->
               %{
                 messages: %{},
                 update_calls: [],
                 update_result: {:ok, %{}}
               }
             end,
             [name: :stream_watchdog_test_state]
           ]}
      })

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

  test "forces ERROR after max retries of ACTIVE", %{server: server} do
    put_message("message-force-error", %{
      "id" => "message-force-error",
      "streamingStatus" => "ACTIVE",
      "content" => ""
    })

    set_update_result({:ok, %{}})
    StreamWatchdog.register_stream("channel-e", "message-force-error", server)

    assert_receive {:broadcast, "room:channel-e", "stream_error", payload}, 500
    assert payload["messageId"] == "message-force-error"
    assert payload["status"] == "error"
    assert payload["error"] == "Stream timed out — no completion received"

    [update_call | _] = update_calls()
    assert update_call.message_id == "message-force-error"
    assert update_call.body["streamingStatus"] == "ERROR"
  end

  test "resets retry count when stream is re-registered", %{server: server} do
    put_message("message-reregister", %{
      "id" => "message-reregister",
      "streamingStatus" => "ACTIVE",
      "content" => ""
    })

    StreamWatchdog.register_stream("channel-f", "message-reregister", server)
    Process.sleep(70)

    state_before = :sys.get_state(server)
    entry_before = get_in(state_before, [:active, "message-reregister"])
    assert entry_before != nil
    assert Map.get(entry_before, :retries, 0) > 0

    retries_before = Map.get(entry_before, :retries, 0)

    StreamWatchdog.deregister_stream("message-reregister", server)
    StreamWatchdog.register_stream("channel-f", "message-reregister", server)

    state_after = :sys.get_state(server)
    entry_after = get_in(state_after, [:active, "message-reregister"])
    assert entry_after != nil
    retries_after = Map.get(entry_after, :retries, 0)
    assert retries_after < retries_before
  end

  test "force-update failure still broadcasts stream_error", %{server: server} do
    put_message("message-force-failure", %{
      "id" => "message-force-failure",
      "streamingStatus" => "ACTIVE",
      "content" => ""
    })

    set_update_result({:error, :nxdomain})
    StreamWatchdog.register_stream("channel-g", "message-force-failure", server)

    assert_receive {:broadcast, "room:channel-g", "stream_error", payload}, 500
    assert payload["messageId"] == "message-force-failure"
    assert payload["status"] == "error"
    assert payload["error"] == "Stream timed out — no completion received"
    assert payload["partialContent"] == nil

    [update_call | _] = update_calls()
    assert update_call.message_id == "message-force-failure"
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
      messages = Map.put(Map.get(state, :messages, %{}), message_id, {:ok, message})
      Map.put(state, :messages, messages)
    end)
  end

  defp set_update_result(result) do
    Agent.update(:stream_watchdog_test_state, fn state ->
      Map.put(state, :update_result, result)
    end)
  end

  defp update_calls do
    Agent.get(:stream_watchdog_test_state, fn state ->
      state
      |> Map.get(:update_calls, [])
      |> Enum.reverse()
    end)
  end
end
