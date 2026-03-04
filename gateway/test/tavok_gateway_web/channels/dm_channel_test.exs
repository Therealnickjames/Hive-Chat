defmodule TavokGatewayWeb.DmChannelTest do
  @moduledoc """
  Unit tests for DmChannel pure/deterministic logic.

  Since DmChannel.parse_sequence/1 is private, we test it indirectly through
  the public handle_in("sync", ...) handler. Content validation and bot rejection
  are tested via handle_in("new_message", ...) and join/3.
  """
  use ExUnit.Case

  @moduletag :unit

  alias TavokGatewayWeb.DmChannel

  # ---------------------------------------------------------------------------
  # parse_sequence/1 — tested indirectly via handle_in("sync", ...)
  #
  # The sync handler calls parse_sequence(last_sequence). When parse_sequence
  # returns {:error, _}, sync replies {:error, %{reason: "invalid_sequence"}}.
  # When parse_sequence returns {:ok, nil}, sync replies {:error, %{reason: "invalid_sequence"}}
  # because the guard `when not is_nil(parsed)` rejects nil.
  # When parse_sequence returns {:ok, integer}, the code tries WebClient which
  # will fail in test — but the error will be "sync_failed", NOT "invalid_sequence",
  # proving parse_sequence accepted the value.
  # ---------------------------------------------------------------------------

  describe "parse_sequence via sync handler" do
    setup do
      # Minimal socket with required assigns for sync handler
      socket = %Phoenix.Socket{
        assigns: %{
          dm_id: "dm-test-123",
          user_id: "user-1",
          username: "tester",
          display_name: "Tester"
        }
      }

      {:ok, socket: socket}
    end

    test "nil sequence is rejected (sync requires non-nil)", %{socket: socket} do
      # parse_sequence(nil) -> {:ok, nil}, but sync rejects nil with "invalid_sequence"
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", %{"lastSequence" => nil}, socket)

      assert reason == "invalid_sequence"
    end

    test "string 'abc' is rejected as invalid_sequence", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", %{"lastSequence" => "abc"}, socket)

      assert reason == "invalid_sequence"
    end

    test "float 1.5 is rejected as invalid_sequence", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", %{"lastSequence" => 1.5}, socket)

      assert reason == "invalid_sequence"
    end

    test "atom :bad is rejected as invalid_sequence", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", %{"lastSequence" => :bad}, socket)

      assert reason == "invalid_sequence"
    end

    test "integer 123 passes parse_sequence (fails downstream at WebClient)", %{socket: socket} do
      # parse_sequence(123) -> {:ok, 123}, sync proceeds to WebClient which errors
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", %{"lastSequence" => 123}, socket)

      # The key assertion: NOT "invalid_sequence" — proving parse_sequence accepted it
      refute reason == "invalid_sequence",
             "Integer sequence should pass parse_sequence validation"
    end

    test "string '123' passes parse_sequence (fails downstream at WebClient)", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", %{"lastSequence" => "123"}, socket)

      refute reason == "invalid_sequence",
             "Numeric string sequence should pass parse_sequence validation"
    end

    test "string '0' passes parse_sequence", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", %{"lastSequence" => "0"}, socket)

      refute reason == "invalid_sequence",
             "Zero string sequence should pass parse_sequence validation"
    end

    test "integer 0 passes parse_sequence", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", %{"lastSequence" => 0}, socket)

      refute reason == "invalid_sequence",
             "Zero integer sequence should pass parse_sequence validation"
    end

    test "missing lastSequence key returns invalid_payload", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", %{}, socket)

      assert reason == "invalid_payload"
    end

    test "non-map payload returns invalid_payload", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("sync", "not-a-map", socket)

      assert reason == "invalid_payload"
    end
  end

  # ---------------------------------------------------------------------------
  # new_message content validation
  # ---------------------------------------------------------------------------

  describe "new_message content validation" do
    setup do
      socket = %Phoenix.Socket{
        assigns: %{
          dm_id: "dm-test-456",
          user_id: "user-1",
          username: "tester",
          display_name: "Tester"
        }
      }

      {:ok, socket: socket}
    end

    test "rejects empty string content", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("new_message", %{"content" => ""}, socket)

      assert reason == "empty_content"
    end

    test "rejects whitespace-only content", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("new_message", %{"content" => "   \t\n  "}, socket)

      assert reason == "empty_content"
    end

    test "rejects content exceeding 4000 characters", %{socket: socket} do
      long_content = String.duplicate("a", 4001)

      {:reply, {:error, %{reason: reason, max: max}}, _socket} =
        DmChannel.handle_in("new_message", %{"content" => long_content}, socket)

      assert reason == "content_too_long"
      assert max == 4000
    end

    test "content at exactly 4000 characters passes validation (fails downstream)", %{
      socket: socket
    } do
      exact_content = String.duplicate("a", 4000)

      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("new_message", %{"content" => exact_content}, socket)

      # Should NOT be content_too_long — validation passed, failed at Redis/sequence
      refute reason == "content_too_long",
             "Content at exactly 4000 chars should pass length validation"

      refute reason == "empty_content",
             "Non-empty content should pass empty check"
    end

    test "valid content passes validation (fails downstream at Redis)", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("new_message", %{"content" => "Hello there"}, socket)

      refute reason == "empty_content"
      refute reason == "content_too_long"
    end

    test "rejects non-binary content (missing content key)", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("new_message", %{"wrong_key" => "hello"}, socket)

      assert reason == "invalid_payload"
    end

    test "rejects integer content", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("new_message", %{"content" => 42}, socket)

      assert reason == "invalid_payload"
    end
  end

  # ---------------------------------------------------------------------------
  # message_edit content validation
  # ---------------------------------------------------------------------------

  describe "message_edit content validation" do
    setup do
      socket = %Phoenix.Socket{
        assigns: %{
          dm_id: "dm-test-789",
          user_id: "user-1",
          username: "tester",
          display_name: "Tester"
        }
      }

      {:ok, socket: socket}
    end

    test "rejects empty content on edit", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in(
          "message_edit",
          %{"messageId" => "msg-1", "content" => ""},
          socket
        )

      assert reason == "empty_content"
    end

    test "rejects whitespace-only content on edit", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in(
          "message_edit",
          %{"messageId" => "msg-1", "content" => "   "},
          socket
        )

      assert reason == "empty_content"
    end

    test "rejects missing messageId", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in(
          "message_edit",
          %{"content" => "hello"},
          socket
        )

      assert reason == "invalid_payload"
    end

    test "rejects missing content key", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in(
          "message_edit",
          %{"messageId" => "msg-1"},
          socket
        )

      assert reason == "invalid_payload"
    end
  end

  # ---------------------------------------------------------------------------
  # message_delete payload validation
  # ---------------------------------------------------------------------------

  describe "message_delete payload validation" do
    setup do
      socket = %Phoenix.Socket{
        assigns: %{
          dm_id: "dm-test-del",
          user_id: "user-1",
          username: "tester",
          display_name: "Tester"
        }
      }

      {:ok, socket: socket}
    end

    test "rejects missing messageId", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("message_delete", %{}, socket)

      assert reason == "invalid_payload"
    end

    test "rejects non-string messageId", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("message_delete", %{"messageId" => 123}, socket)

      assert reason == "invalid_payload"
    end
  end

  # ---------------------------------------------------------------------------
  # Bot join rejection — DMs are human-only
  # ---------------------------------------------------------------------------

  describe "bot join rejection" do
    test "bots cannot join DM channels" do
      socket = %Phoenix.Socket{
        assigns: %{
          user_id: "bot-agent-1",
          username: "agent",
          display_name: "Agent",
          author_type: "BOT"
        }
      }

      result = DmChannel.join("dm:dm-channel-1", %{}, socket)

      assert {:error, %{reason: "bots_cannot_join_dms"}} = result
    end
  end

  # ---------------------------------------------------------------------------
  # history handler payload validation
  # ---------------------------------------------------------------------------

  describe "history payload validation" do
    setup do
      socket = %Phoenix.Socket{
        assigns: %{
          dm_id: "dm-test-hist",
          user_id: "user-1",
          username: "tester",
          display_name: "Tester"
        }
      }

      {:ok, socket: socket}
    end

    test "rejects non-map payload", %{socket: socket} do
      {:reply, {:error, %{reason: reason}}, _socket} =
        DmChannel.handle_in("history", "not-a-map", socket)

      assert reason == "invalid_payload"
    end
  end
end
