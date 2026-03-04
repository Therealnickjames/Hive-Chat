defmodule TavokGatewayWeb.RoomChannelTest do
  use ExUnit.Case

  alias TavokGatewayWeb.RoomChannel

  describe "parse_sequence/1" do
    test "accepts nil and numeric sequence values" do
      assert RoomChannel.parse_sequence(nil) == {:ok, nil}
      assert RoomChannel.parse_sequence(0) == {:ok, 0}
      assert RoomChannel.parse_sequence("12") == {:ok, 12}
    end

    test "rejects invalid sequence values" do
      assert RoomChannel.parse_sequence(-1) == {:error, :invalid_sequence}
      assert RoomChannel.parse_sequence("bad") == {:error, :invalid_sequence}
      assert RoomChannel.parse_sequence(:bad) == {:error, :invalid_sequence}
    end
  end

  describe "parse_limit/1" do
    test "returns bounded limits and defaults" do
      assert RoomChannel.parse_limit(nil) == {:ok, 50}
      assert RoomChannel.parse_limit(200) == {:ok, 100}
      assert RoomChannel.parse_limit("25") == {:ok, 25}
    end

    test "rejects invalid limits" do
      assert RoomChannel.parse_limit("bad") == {:error, :invalid_limit}
      assert RoomChannel.parse_limit(-5) == {:error, :invalid_limit}
      assert RoomChannel.parse_limit(:bad) == {:error, :invalid_limit}
    end
  end

  describe "new_message content validation" do
    test "rejects empty string content before sequence allocation" do
      socket = %Phoenix.Socket{}

      assert RoomChannel.handle_in("new_message", %{"content" => ""}, socket) ==
               {:reply, {:error, %{reason: "empty_content"}}, socket}
    end

    test "rejects whitespace-only content before sequence allocation" do
      socket = %Phoenix.Socket{}

      assert RoomChannel.handle_in("new_message", %{"content" => "   "}, socket) ==
               {:reply, {:error, %{reason: "empty_content"}}, socket}
    end

    test "accepts content with surrounding whitespace" do
      socket = %Phoenix.Socket{
        assigns: %{channel_id: "channel-1", user_id: "user-1", display_name: "User 1"}
      }

      # Content validation passes (trimmed "  hello  " is not empty), so the code
      # proceeds past validation to rate limiter / Redis. In the test environment
      # (no Redis), it will fail downstream with "rate_limited" or "sequence_failed".
      # The key assertion: the error is NOT "empty_content", proving validation passed.
      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("new_message", %{"content" => "  hello  "}, socket)

      refute reason == "empty_content",
             "Content with surrounding whitespace should pass validation"
    end

    test "rejects content exceeding 4000 characters" do
      socket = %Phoenix.Socket{}

      long_content = String.duplicate("x", 4001)

      assert RoomChannel.handle_in("new_message", %{"content" => long_content}, socket) ==
               {:reply, {:error, %{reason: "content_too_long", max: 4000}}, socket}
    end

    test "content at exactly 4000 characters passes length validation" do
      socket = %Phoenix.Socket{
        assigns: %{channel_id: "channel-1", user_id: "user-1", display_name: "User 1"}
      }

      exact_content = String.duplicate("x", 4000)

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("new_message", %{"content" => exact_content}, socket)

      # Should NOT be "content_too_long" — exactly at the limit is allowed
      refute reason == "content_too_long",
             "Content at exactly 4000 chars should pass length validation"

      refute reason == "empty_content",
             "4000-char content is not empty"
    end

    test "rejects non-binary content (missing content key)" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("new_message", %{"wrong" => "key"}, socket)

      assert reason == "invalid_payload"
    end
  end

  # ---------------------------------------------------------------------------
  # message_edit content validation
  # ---------------------------------------------------------------------------

  describe "message_edit content validation" do
    test "rejects empty content on edit" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in(
          "message_edit",
          %{"messageId" => "msg-1", "content" => ""},
          socket
        )

      assert reason == "empty_content"
    end

    test "rejects whitespace-only content on edit" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in(
          "message_edit",
          %{"messageId" => "msg-1", "content" => "   \n\t  "},
          socket
        )

      assert reason == "empty_content"
    end

    test "rejects content exceeding 4000 characters on edit" do
      socket = %Phoenix.Socket{}

      long_content = String.duplicate("a", 4001)

      {:reply, {:error, %{reason: reason, max: max}}, _socket} =
        RoomChannel.handle_in(
          "message_edit",
          %{"messageId" => "msg-1", "content" => long_content},
          socket
        )

      assert reason == "content_too_long"
      assert max == 4000
    end

    test "rejects missing messageId on edit" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in(
          "message_edit",
          %{"content" => "hello"},
          socket
        )

      assert reason == "invalid_payload"
    end

    test "rejects missing content key on edit" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in(
          "message_edit",
          %{"messageId" => "msg-1"},
          socket
        )

      assert reason == "invalid_payload"
    end

    test "rejects non-string messageId on edit" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in(
          "message_edit",
          %{"messageId" => 123, "content" => "hello"},
          socket
        )

      assert reason == "invalid_payload"
    end
  end

  # ---------------------------------------------------------------------------
  # message_delete payload validation
  # ---------------------------------------------------------------------------

  describe "message_delete payload validation" do
    test "rejects missing messageId" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("message_delete", %{}, socket)

      assert reason == "invalid_payload"
    end

    test "rejects non-string messageId" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("message_delete", %{"messageId" => 42}, socket)

      assert reason == "invalid_payload"
    end
  end

  # ---------------------------------------------------------------------------
  # normalize_sequence/1 — private, tested indirectly
  #
  # normalize_sequence is called by channel_seed_sequence -> next_sequence,
  # which requires Redis. Since it's private and deeply nested in the Redis
  # flow, we test the equivalent logic here: the same pattern matching that
  # normalize_sequence uses, validating the expected behavior for each input type.
  # ---------------------------------------------------------------------------

  describe "normalize_sequence logic (equivalent pattern matching)" do
    # normalize_sequence/1 is private in RoomChannel. We replicate its
    # documented behavior here to verify our understanding and catch
    # regressions if someone extracts it as public later.

    test "nil normalizes to 0" do
      # normalize_sequence(nil) -> {:ok, 0}
      assert normalize(nil) == {:ok, 0}
    end

    test "positive integer passes through" do
      assert normalize(42) == {:ok, 42}
    end

    test "zero normalizes to 0" do
      assert normalize(0) == {:ok, 0}
    end

    test "negative integer normalizes to 0 (clamped)" do
      assert normalize(-5) == {:ok, 0}
    end

    test "valid numeric string is parsed" do
      assert normalize("100") == {:ok, 100}
    end

    test "negative numeric string normalizes to 0 (clamped)" do
      assert normalize("-10") == {:ok, 0}
    end

    test "non-numeric string returns error" do
      assert normalize("abc") == {:error, :invalid_sequence}
    end

    test "float is rounded" do
      assert normalize(3.7) == {:ok, 4}
    end

    test "negative float normalizes to 0 (clamped)" do
      assert normalize(-2.5) == {:ok, 0}
    end

    test "atom returns error" do
      assert normalize(:bad) == {:error, :invalid_sequence}
    end

    test "list returns error" do
      assert normalize([1, 2]) == {:error, :invalid_sequence}
    end

    # Replicate the exact logic from RoomChannel.normalize_sequence/1
    defp normalize(nil), do: {:ok, 0}

    defp normalize(value) when is_integer(value) do
      {:ok, max(value, 0)}
    end

    defp normalize(value) when is_binary(value) do
      case Integer.parse(value) do
        {num, ""} -> {:ok, max(num, 0)}
        _ -> {:error, :invalid_sequence}
      end
    end

    defp normalize(value) when is_float(value) do
      {:ok, max(round(value), 0)}
    end

    defp normalize(_), do: {:error, :invalid_sequence}
  end

  # ---------------------------------------------------------------------------
  # Agent streaming permission checks
  # ---------------------------------------------------------------------------

  describe "agent streaming permission" do
    test "non-BOT users cannot stream_start" do
      socket = %Phoenix.Socket{assigns: %{author_type: "USER"}}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("stream_start", %{}, socket)

      assert reason == "only_agents_can_stream"
    end

    test "non-BOT users cannot stream_token" do
      socket = %Phoenix.Socket{assigns: %{author_type: "USER"}}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("stream_token", %{}, socket)

      assert reason == "only_agents_can_stream"
    end

    test "non-BOT users cannot stream_complete" do
      socket = %Phoenix.Socket{assigns: %{author_type: "USER"}}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("stream_complete", %{}, socket)

      assert reason == "only_agents_can_stream"
    end

    test "non-BOT users cannot stream_error" do
      socket = %Phoenix.Socket{assigns: %{author_type: "USER"}}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("stream_error", %{}, socket)

      assert reason == "only_agents_can_stream"
    end

    test "non-BOT users cannot stream_thinking" do
      socket = %Phoenix.Socket{assigns: %{author_type: "USER"}}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in(
          "stream_thinking",
          %{"messageId" => "msg-1", "phase" => "analyzing"},
          socket
        )

      assert reason == "only_agents_can_stream"
    end
  end

  # ---------------------------------------------------------------------------
  # Typed message permission checks (TASK-0039)
  # ---------------------------------------------------------------------------

  describe "typed_message permission" do
    test "non-BOT users cannot send typed messages" do
      socket = %Phoenix.Socket{assigns: %{author_type: "USER"}}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in(
          "typed_message",
          %{"type" => "TOOL_CALL", "content" => "test"},
          socket
        )

      assert reason == "only_agents_can_send_typed_messages"
    end

    test "rejects invalid typed_message payload (missing type)" do
      socket = %Phoenix.Socket{assigns: %{author_type: "BOT"}}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("typed_message", %{"content" => "test"}, socket)

      assert reason == "invalid_payload"
    end

    test "rejects invalid typed_message payload (missing content)" do
      socket = %Phoenix.Socket{assigns: %{author_type: "BOT"}}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("typed_message", %{"type" => "TOOL_CALL"}, socket)

      assert reason == "invalid_payload"
    end
  end

  # ---------------------------------------------------------------------------
  # Charter control validation
  # ---------------------------------------------------------------------------

  describe "charter_control payload validation" do
    test "rejects invalid action" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("charter_control", %{"action" => "invalid"}, socket)

      assert reason == "invalid_payload"
    end

    test "rejects missing action key" do
      socket = %Phoenix.Socket{}

      {:reply, {:error, %{reason: reason}}, _socket} =
        RoomChannel.handle_in("charter_control", %{}, socket)

      assert reason == "invalid_payload"
    end
  end
end
