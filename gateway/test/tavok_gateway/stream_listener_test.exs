defmodule TavokGateway.StreamListenerTest do
  @moduledoc """
  Unit tests for StreamListener message routing logic.

  StreamListener.handle_stream_message/2 is private, and init/1 requires a
  live Redis connection. To test the routing logic without Redis, we:
  1. Test the channel format parsing (String.split patterns) that the router uses
  2. Test the JSON decode path for status messages (complete vs error vs unknown)
  3. Test by sending simulated {:redix_pubsub, ...} messages to a lightweight
     GenServer that captures broadcasts instead of calling the real Endpoint.

  The TestStreamRouter module below replicates the exact pattern-matching logic
  from StreamListener.handle_stream_message/2, calling a test-friendly broadcaster
  instead of Broadcast.endpoint_broadcast_raw!/3.
  """
  use ExUnit.Case

  @moduletag :unit

  # ---------------------------------------------------------------------------
  # TestStreamRouter — mirrors StreamListener.handle_stream_message/2 logic
  # but routes to a test process instead of the Phoenix Endpoint.
  # This validates that the pattern matching and routing are correct.
  # ---------------------------------------------------------------------------

  defmodule TestStreamRouter do
    @moduledoc false

    def route(channel, payload, test_pid) do
      handle_stream_message(channel, payload, test_pid)
    end

    defp handle_stream_message("hive:stream:tokens:" <> rest, payload, test_pid) do
      case String.split(rest, ":", parts: 2) do
        [channel_id, _message_id] ->
          send(test_pid, {:broadcast, "room:#{channel_id}", "stream_token", payload})

        _ ->
          send(test_pid, {:error, :invalid_token_channel_format, rest})
      end
    end

    defp handle_stream_message("hive:stream:status:" <> rest, payload, test_pid) do
      case String.split(rest, ":", parts: 2) do
        [channel_id, _message_id] ->
          case Jason.decode(payload) do
            {:ok, %{"status" => "complete"} = _data} ->
              send(test_pid, {:broadcast, "room:#{channel_id}", "stream_complete", payload})

            {:ok, %{"status" => "error"} = _data} ->
              send(test_pid, {:broadcast, "room:#{channel_id}", "stream_error", payload})

            {:ok, %{"status" => status}} ->
              send(test_pid, {:unknown_status, status})

            {:error, _} ->
              send(test_pid, {:error, :decode_failed, payload})
          end

        _ ->
          send(test_pid, {:error, :invalid_status_channel_format, rest})
      end
    end

    defp handle_stream_message("hive:stream:thinking:" <> rest, payload, test_pid) do
      case String.split(rest, ":", parts: 2) do
        [channel_id, _message_id] ->
          send(test_pid, {:broadcast, "room:#{channel_id}", "stream_thinking", payload})

        _ ->
          send(test_pid, {:error, :invalid_thinking_channel_format, rest})
      end
    end

    defp handle_stream_message("hive:stream:tool_call:" <> rest, payload, test_pid) do
      case String.split(rest, ":", parts: 2) do
        [channel_id, _message_id] ->
          send(test_pid, {:broadcast, "room:#{channel_id}", "stream_tool_call", payload})

        _ ->
          send(test_pid, {:error, :invalid_tool_call_channel_format, rest})
      end
    end

    defp handle_stream_message("hive:stream:tool_result:" <> rest, payload, test_pid) do
      case String.split(rest, ":", parts: 2) do
        [channel_id, _message_id] ->
          send(test_pid, {:broadcast, "room:#{channel_id}", "stream_tool_result", payload})

        _ ->
          send(test_pid, {:error, :invalid_tool_result_channel_format, rest})
      end
    end

    defp handle_stream_message("hive:stream:checkpoint:" <> rest, payload, test_pid) do
      case String.split(rest, ":", parts: 2) do
        [channel_id, _message_id] ->
          send(test_pid, {:broadcast, "room:#{channel_id}", "stream_checkpoint", payload})

        _ ->
          send(test_pid, {:error, :invalid_checkpoint_channel_format, rest})
      end
    end

    defp handle_stream_message("hive:stream:charter_status:" <> channel_id, payload, test_pid) do
      send(test_pid, {:broadcast, "room:#{channel_id}", "charter_status", payload})
    end

    defp handle_stream_message(channel, _payload, test_pid) do
      send(test_pid, {:unhandled, channel})
    end
  end

  # ---------------------------------------------------------------------------
  # Channel format parsing tests
  # ---------------------------------------------------------------------------

  describe "channel format parsing" do
    test "standard channelId:messageId format splits correctly" do
      rest = "channel-abc:msg-123"
      assert String.split(rest, ":", parts: 2) == ["channel-abc", "msg-123"]
    end

    test "ULID-based IDs split correctly" do
      rest = "01HXYZ123456789ABCDEF:01HABC987654321ZYXWVU"
      assert String.split(rest, ":", parts: 2) == ["01HXYZ123456789ABCDEF", "01HABC987654321ZYXWVU"]
    end

    test "messageId containing colons is preserved (parts: 2)" do
      # Edge case: if messageId somehow contains colons, parts: 2 ensures
      # only the first colon is used as delimiter
      rest = "channel-1:msg:with:colons"
      assert String.split(rest, ":", parts: 2) == ["channel-1", "msg:with:colons"]
    end

    test "no colon in rest produces single-element list" do
      rest = "no-colon-here"
      result = String.split(rest, ":", parts: 2)
      assert result == ["no-colon-here"]
    end

    test "empty string produces single-element list" do
      rest = ""
      result = String.split(rest, ":", parts: 2)
      assert result == [""]
    end
  end

  # ---------------------------------------------------------------------------
  # Token routing
  # ---------------------------------------------------------------------------

  describe "token message routing" do
    test "routes stream_token to correct room topic" do
      channel = "hive:stream:tokens:channel-abc:msg-123"
      payload = ~s({"messageId":"msg-123","token":"hello","index":1})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:broadcast, "room:channel-abc", "stream_token", ^payload}
    end

    test "token with ULID channel and message IDs" do
      channel = "hive:stream:tokens:01HCHANNEL:01HMESSAGE"
      payload = ~s({"messageId":"01HMESSAGE","token":" world","index":2})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:broadcast, "room:01HCHANNEL", "stream_token", ^payload}
    end

    test "invalid token channel format (no messageId) reports error" do
      channel = "hive:stream:tokens:no-message-id"
      payload = ~s({"token":"test"})

      TestStreamRouter.route(channel, payload, self())

      # With parts: 2, "no-message-id" becomes ["no-message-id"] which is a single element.
      # Wait - actually String.split("no-message-id", ":", parts: 2) = ["no-message-id"]
      # which has length 1, so it hits the catch-all error branch
      assert_receive {:error, :invalid_token_channel_format, "no-message-id"}
    end
  end

  # ---------------------------------------------------------------------------
  # Status routing (complete vs error vs unknown)
  # ---------------------------------------------------------------------------

  describe "status message routing" do
    test "complete status broadcasts stream_complete" do
      channel = "hive:stream:status:channel-1:msg-1"
      payload = Jason.encode!(%{messageId: "msg-1", status: "complete", finalContent: "Done"})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:broadcast, "room:channel-1", "stream_complete", ^payload}
    end

    test "error status broadcasts stream_error" do
      channel = "hive:stream:status:channel-2:msg-2"

      payload =
        Jason.encode!(%{messageId: "msg-2", status: "error", error: "Provider timeout"})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:broadcast, "room:channel-2", "stream_error", ^payload}
    end

    test "unknown status (e.g., 'active') does not broadcast" do
      channel = "hive:stream:status:channel-3:msg-3"
      payload = Jason.encode!(%{messageId: "msg-3", status: "active"})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:unknown_status, "active"}
      refute_receive {:broadcast, _, _, _}
    end

    test "invalid JSON payload reports decode error" do
      channel = "hive:stream:status:channel-4:msg-4"
      payload = "not valid json{{"

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:error, :decode_failed, ^payload}
    end

    test "invalid status channel format reports error" do
      channel = "hive:stream:status:no-message-id"
      payload = Jason.encode!(%{status: "complete"})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:error, :invalid_status_channel_format, "no-message-id"}
    end
  end

  # ---------------------------------------------------------------------------
  # Thinking routing
  # ---------------------------------------------------------------------------

  describe "thinking message routing" do
    test "routes stream_thinking to correct room" do
      channel = "hive:stream:thinking:channel-t1:msg-t1"
      payload = ~s({"messageId":"msg-t1","phase":"analyzing","detail":"Processing input"})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:broadcast, "room:channel-t1", "stream_thinking", ^payload}
    end

    test "invalid thinking channel format reports error" do
      channel = "hive:stream:thinking:no-colon"
      payload = ~s({"phase":"test"})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:error, :invalid_thinking_channel_format, "no-colon"}
    end
  end

  # ---------------------------------------------------------------------------
  # Tool call routing (TASK-0018)
  # ---------------------------------------------------------------------------

  describe "tool_call message routing" do
    test "routes stream_tool_call to correct room" do
      channel = "hive:stream:tool_call:channel-tc:msg-tc"
      payload = ~s({"messageId":"msg-tc","toolName":"search","args":{"query":"test"}})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:broadcast, "room:channel-tc", "stream_tool_call", ^payload}
    end
  end

  # ---------------------------------------------------------------------------
  # Tool result routing (TASK-0018)
  # ---------------------------------------------------------------------------

  describe "tool_result message routing" do
    test "routes stream_tool_result to correct room" do
      channel = "hive:stream:tool_result:channel-tr:msg-tr"
      payload = ~s({"messageId":"msg-tr","toolName":"search","result":"found 5 items"})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:broadcast, "room:channel-tr", "stream_tool_result", ^payload}
    end
  end

  # ---------------------------------------------------------------------------
  # Checkpoint routing (TASK-0021)
  # ---------------------------------------------------------------------------

  describe "checkpoint message routing" do
    test "routes stream_checkpoint to correct room" do
      channel = "hive:stream:checkpoint:channel-cp:msg-cp"
      payload = ~s({"messageId":"msg-cp","checkpointId":"cp-1","tokenCount":150})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:broadcast, "room:channel-cp", "stream_checkpoint", ^payload}
    end
  end

  # ---------------------------------------------------------------------------
  # Charter status routing (TASK-0020)
  # ---------------------------------------------------------------------------

  describe "charter_status message routing" do
    test "routes charter_status to correct room (no messageId in channel)" do
      # Charter status channel format is different: hive:stream:charter_status:{channelId}
      # (no messageId suffix)
      channel = "hive:stream:charter_status:channel-cs"
      payload = ~s({"status":"paused","channelId":"channel-cs"})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:broadcast, "room:channel-cs", "charter_status", ^payload}
    end
  end

  # ---------------------------------------------------------------------------
  # Unhandled channels
  # ---------------------------------------------------------------------------

  describe "unhandled channel patterns" do
    test "completely unknown prefix is handled gracefully" do
      channel = "hive:something:else:channel-1:msg-1"
      payload = ~s({"data":"test"})

      TestStreamRouter.route(channel, payload, self())

      assert_receive {:unhandled, ^channel}
    end

    test "empty channel string is handled gracefully" do
      TestStreamRouter.route("", ~s({}), self())

      assert_receive {:unhandled, ""}
    end
  end

  # ---------------------------------------------------------------------------
  # Status payload JSON parsing
  # ---------------------------------------------------------------------------

  describe "status payload JSON parsing" do
    test "complete status with all fields decodes correctly" do
      payload =
        Jason.encode!(%{
          messageId: "msg-full",
          status: "complete",
          finalContent: "Full response text here",
          tokenCount: 150,
          thinkingTimeline: [
            %{phase: "analyzing", timestamp: "2024-01-01T00:00:00Z"},
            %{phase: "writing", timestamp: "2024-01-01T00:00:01Z"}
          ]
        })

      {:ok, decoded} = Jason.decode(payload)
      assert decoded["status"] == "complete"
      assert decoded["messageId"] == "msg-full"
      assert decoded["finalContent"] == "Full response text here"
      assert length(decoded["thinkingTimeline"]) == 2
    end

    test "error status with error message decodes correctly" do
      payload =
        Jason.encode!(%{
          messageId: "msg-err",
          status: "error",
          error: "Provider rate limited",
          partialContent: "I was going to say"
        })

      {:ok, decoded} = Jason.decode(payload)
      assert decoded["status"] == "error"
      assert decoded["error"] == "Provider rate limited"
      assert decoded["partialContent"] == "I was going to say"
    end

    test "missing status field does not match complete or error" do
      payload = Jason.encode!(%{messageId: "msg-no-status"})
      {:ok, decoded} = Jason.decode(payload)

      # Neither "complete" nor "error" pattern matches
      refute match?(%{"status" => "complete"}, decoded)
      refute match?(%{"status" => "error"}, decoded)
    end
  end
end
