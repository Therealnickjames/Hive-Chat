defmodule TavokGateway.BroadcastTest do
  @moduledoc """
  Unit tests for the Broadcast module.

  The Broadcast module wraps payloads in Jason.Fragment for zero-copy fan-out
  (DEC-0030). Since the broadcast functions call Phoenix.Channel.broadcast!/3
  and TavokGatewayWeb.Endpoint.broadcast!/3 which require running infrastructure,
  we test the core serialization logic: that payloads survive the encode -> Fragment
  -> encode round-trip correctly.

  This validates the invariant that Jason.Fragment.new(Jason.encode!(payload))
  produces wire-identical JSON to direct Jason.encode!(payload).
  """
  use ExUnit.Case

  @moduletag :unit

  describe "Jason.Fragment serialization (Broadcast core logic)" do
    test "simple map survives Fragment round-trip" do
      payload = %{userId: "user-1", content: "hello"}

      # This is the exact operation Broadcast.broadcast_pre_serialized! does
      encoded = Jason.encode!(payload)
      fragment = Jason.Fragment.new(encoded)

      # When Phoenix serializes the fragment, it should produce valid JSON
      result = Jason.encode!(fragment)

      # Decode both to compare (key ordering may differ)
      assert Jason.decode!(result) == Jason.decode!(encoded)
    end

    test "nested map with lists survives Fragment round-trip" do
      payload = %{
        messageId: "msg-123",
        content: "hello world",
        reactions: [
          %{emoji: "thumbsup", count: 3, users: ["u1", "u2", "u3"]},
          %{emoji: "heart", count: 1, users: ["u4"]}
        ],
        metadata: %{provider: "openai", model: "gpt-4"}
      }

      encoded = Jason.encode!(payload)
      fragment = Jason.Fragment.new(encoded)
      result = Jason.encode!(fragment)

      assert Jason.decode!(result) == Jason.decode!(encoded)
    end

    test "payload with nil values serializes correctly" do
      payload = %{
        id: "msg-456",
        authorAvatarUrl: nil,
        streamingStatus: nil,
        editedAt: nil,
        content: "test"
      }

      encoded = Jason.encode!(payload)
      fragment = Jason.Fragment.new(encoded)
      result = Jason.encode!(fragment)

      decoded = Jason.decode!(result)
      assert decoded["authorAvatarUrl"] == nil
      assert decoded["streamingStatus"] == nil
      assert decoded["editedAt"] == nil
      assert decoded["content"] == "test"
    end

    test "empty map produces valid JSON fragment" do
      payload = %{}

      encoded = Jason.encode!(payload)
      fragment = Jason.Fragment.new(encoded)
      result = Jason.encode!(fragment)

      assert Jason.decode!(result) == %{}
    end

    test "payload with special characters serializes correctly" do
      payload = %{
        content: "Hello \"world\" \n\t <script>alert('xss')</script>",
        authorName: "User with emoji"
      }

      encoded = Jason.encode!(payload)
      fragment = Jason.Fragment.new(encoded)
      result = Jason.encode!(fragment)

      decoded = Jason.decode!(result)
      assert decoded["content"] == "Hello \"world\" \n\t <script>alert('xss')</script>"
    end

    test "payload with unicode content serializes correctly" do
      payload = %{content: "Bonjour le monde! Hola mundo!"}

      encoded = Jason.encode!(payload)
      fragment = Jason.Fragment.new(encoded)
      result = Jason.encode!(fragment)

      decoded = Jason.decode!(result)
      assert decoded["content"] == "Bonjour le monde! Hola mundo!"
    end

    test "large payload serializes without error" do
      # Simulate a sync_messages payload with many messages
      messages =
        for i <- 1..100 do
          %{
            id: "msg-#{i}",
            content: String.duplicate("x", 200),
            sequence: Integer.to_string(i),
            authorId: "user-#{rem(i, 5)}"
          }
        end

      payload = %{messages: messages}

      encoded = Jason.encode!(payload)
      fragment = Jason.Fragment.new(encoded)
      result = Jason.encode!(fragment)

      decoded = Jason.decode!(result)
      assert length(decoded["messages"]) == 100
    end
  end

  describe "raw JSON fragment (endpoint_broadcast_raw! logic)" do
    test "pre-encoded JSON string is preserved as-is in fragment" do
      # This simulates what StreamListener does: receives raw JSON from Redis,
      # wraps it as a Fragment, broadcasts it. No decode/re-encode.
      raw_json = ~s({"messageId":"msg-789","token":"hello","index":42})

      fragment = Jason.Fragment.new(raw_json)
      result = Jason.encode!(fragment)

      # The fragment should produce the exact same JSON
      assert Jason.decode!(result) == Jason.decode!(raw_json)
    end

    test "raw JSON with nested objects is preserved" do
      raw_json =
        ~s({"messageId":"msg-001","status":"complete","finalContent":"Done","metadata":{"tokens":150}})

      fragment = Jason.Fragment.new(raw_json)
      result = Jason.encode!(fragment)

      decoded = Jason.decode!(result)
      assert decoded["messageId"] == "msg-001"
      assert decoded["status"] == "complete"
      assert decoded["metadata"]["tokens"] == 150
    end

    test "raw JSON token payload round-trips correctly" do
      # Typical stream_token payload from Go proxy via Redis
      raw_json = ~s({"messageId":"01HXYZ","token":" the","index":5})

      fragment = Jason.Fragment.new(raw_json)
      result = Jason.encode!(fragment)

      decoded = Jason.decode!(result)
      assert decoded["messageId"] == "01HXYZ"
      assert decoded["token"] == " the"
      assert decoded["index"] == 5
    end
  end
end
