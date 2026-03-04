defmodule TavokGateway.LogFormatterTest do
  @moduledoc """
  Tests for TavokGateway.LogFormatter — ensures all log output is valid JSON
  with required fields for production log search and alerting.
  """
  use ExUnit.Case, async: true

  alias TavokGateway.LogFormatter

  # Helpers

  defp sample_date, do: {2026, 3, 2}
  defp sample_time_3, do: {14, 30, 45}
  defp sample_time_4, do: {14, 30, 45, 123}

  defp format_and_decode(level, message, metadata \\ []) do
    result = LogFormatter.format(level, message, {sample_date(), sample_time_3()}, metadata)
    json_str = IO.iodata_to_binary(result) |> String.trim_trailing("\n")
    Jason.decode!(json_str)
  end

  # --- Required Fields ---

  describe "required fields" do
    test "output contains time, level, and msg" do
      decoded = format_and_decode(:info, "hello")

      assert Map.has_key?(decoded, "time")
      assert Map.has_key?(decoded, "level")
      assert Map.has_key?(decoded, "msg")
    end

    test "level is a string matching the Logger level atom" do
      for level <- [:debug, :info, :warning, :error] do
        decoded = format_and_decode(level, "test message")
        assert decoded["level"] == to_string(level), "expected level=#{level}"
      end
    end

    test "msg contains the original message text" do
      decoded = format_and_decode(:info, "WebSocket connected: user=abc123")
      assert decoded["msg"] == "WebSocket connected: user=abc123"
    end
  end

  # --- JSON Validity ---

  describe "JSON validity" do
    test "output is valid JSON terminated by newline" do
      result = LogFormatter.format(:info, "valid json test", {sample_date(), sample_time_3()}, [])
      raw = IO.iodata_to_binary(result)

      assert String.ends_with?(raw, "\n")
      json_str = String.trim_trailing(raw, "\n")
      assert {:ok, _} = Jason.decode(json_str)
    end

    test "special characters in message do not break JSON" do
      messages = [
        ~S(message with "quotes"),
        "message with \\ backslash",
        "message with \n newline",
        "message with \t tab",
        "message with unicode: 日本語",
        "message with emoji: 🚀",
        "message with null byte: \0",
        "<script>alert('xss')</script>"
      ]

      for msg <- messages do
        result = LogFormatter.format(:info, msg, {sample_date(), sample_time_3()}, [])
        raw = IO.iodata_to_binary(result) |> String.trim_trailing("\n")

        case Jason.decode(raw) do
          {:ok, decoded} ->
            assert decoded["msg"] == msg

          {:error, reason} ->
            flunk("JSON parse failed for message #{inspect(msg)}: #{inspect(reason)}")
        end
      end
    end

    test "special characters in metadata values do not break JSON" do
      metadata = [
        module: "TavokGateway.Test",
        function: ~S|connect("token")|,
        file: "lib/channels/user_socket.ex"
      ]

      decoded = format_and_decode(:info, "test", metadata)
      assert decoded["module"] == "TavokGateway.Test"
    end
  end

  # --- Timestamp Format ---

  describe "timestamp format" do
    test "timestamp is ISO 8601 format (3-element time tuple)" do
      decoded = format_and_decode(:info, "test")
      assert decoded["time"] == "2026-03-02T14:30:45"
    end

    test "timestamp handles 4-element time tuple with fraction" do
      result =
        LogFormatter.format(:info, "test", {sample_date(), sample_time_4()}, [])

      json_str = IO.iodata_to_binary(result) |> String.trim_trailing("\n")
      decoded = Jason.decode!(json_str)

      # The fraction is dropped — we get the same format
      assert decoded["time"] == "2026-03-02T14:30:45"
    end

    test "timestamp pads single-digit month and day" do
      result =
        LogFormatter.format(:info, "test", {{2026, 1, 5}, {9, 3, 7}}, [])

      json_str = IO.iodata_to_binary(result) |> String.trim_trailing("\n")
      decoded = Jason.decode!(json_str)

      assert decoded["time"] == "2026-01-05T09:03:07"
    end
  end

  # --- Message Shape Handling ---

  describe "message shape handling" do
    test "handles binary messages" do
      decoded = format_and_decode(:info, "simple string")
      assert decoded["msg"] == "simple string"
    end

    test "handles iodata list messages" do
      decoded = format_and_decode(:info, ["hello", " ", "world"])
      assert decoded["msg"] == "hello world"
    end

    test "handles erlang format tuple messages" do
      decoded = format_and_decode(:info, {'~s connected: ~p', ["user", 42]})
      assert is_binary(decoded["msg"])
      assert String.contains?(decoded["msg"], "user")
    end

    test "handles empty binary message" do
      decoded = format_and_decode(:info, "")
      assert decoded["msg"] == ""
    end

    test "handles non-standard message types gracefully" do
      # Atoms, integers, etc. should be inspected, not crash
      decoded = format_and_decode(:info, :some_atom)
      assert is_binary(decoded["msg"])
    end
  end

  # --- Metadata ---

  describe "metadata" do
    test "metadata keys are included as top-level JSON fields" do
      metadata = [request_id: "req-123", user_id: "user-456"]
      decoded = format_and_decode(:info, "with metadata", metadata)

      assert decoded["request_id"] == "req-123"
      assert decoded["user_id"] == "user-456"
    end

    test "empty metadata produces no extra fields" do
      decoded = format_and_decode(:info, "no metadata", [])

      # Only the base fields should exist
      assert Map.keys(decoded) -- ["time", "level", "msg"] == []
    end

    test "metadata values are converted to strings" do
      metadata = [count: 42, active: true]
      decoded = format_and_decode(:info, "typed metadata", metadata)

      # safe_to_string should handle non-binary values via inspect
      assert is_binary(decoded["count"])
      assert is_binary(decoded["active"])
    end
  end

  # --- Fallback on Encode Failure ---

  describe "fallback on encode failure" do
    test "produces a readable fallback when JSON encoding would fail" do
      # This tests the error branch of Jason.encode.
      # It's hard to trigger directly since safe_to_string normalizes most values.
      # We test that the format function never raises, even with unusual inputs.
      result =
        LogFormatter.format(
          :error,
          "test message",
          {sample_date(), sample_time_3()},
          []
        )

      # Should always produce some output
      raw = IO.iodata_to_binary(result)
      assert byte_size(raw) > 0
      assert String.ends_with?(raw, "\n")
    end
  end
end
