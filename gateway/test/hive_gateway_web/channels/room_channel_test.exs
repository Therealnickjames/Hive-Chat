defmodule HiveGatewayWeb.RoomChannelTest do
  use ExUnit.Case

  alias HiveGatewayWeb.RoomChannel

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

      result = RoomChannel.handle_in("new_message", %{"content" => "  hello  "}, socket)
      refute match?({:reply, {:error, %{reason: "empty_content"}}, _}, result)
    end
  end
end
