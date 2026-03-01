defmodule HiveGateway.Broadcast do
  @moduledoc """
  Pre-serialized broadcast helpers.

  Wraps payloads in `Jason.Fragment` before broadcasting so that
  Phoenix's JSON serializer includes the pre-encoded bytes directly
  instead of re-encoding the payload once per subscriber.

  At 1000 subscribers this eliminates 999 redundant `Jason.encode!()` calls
  per broadcast. The wire format is byte-for-byte identical.

  See docs/DECISIONS.md DEC-0030.
  """

  @doc "Pre-serialize payload, then broadcast to all subscribers in the channel."
  def broadcast_pre_serialized!(socket, event, payload) do
    fragment = Jason.Fragment.new(Jason.encode!(payload))
    Phoenix.Channel.broadcast!(socket, event, fragment)
  end

  @doc "Pre-serialize payload, then broadcast to all except sender."
  def broadcast_from_pre_serialized!(socket, event, payload) do
    fragment = Jason.Fragment.new(Jason.encode!(payload))
    Phoenix.Channel.broadcast_from!(socket, event, fragment)
  end

  @doc "Pre-serialize payload, then broadcast via Endpoint (for code outside channel processes)."
  def endpoint_broadcast!(topic, event, payload) do
    fragment = Jason.Fragment.new(Jason.encode!(payload))
    HiveGatewayWeb.Endpoint.broadcast!(topic, event, fragment)
  end

  @doc "Wrap raw JSON string as fragment and broadcast (zero-copy from Redis)."
  def endpoint_broadcast_raw!(topic, event, raw_json) do
    fragment = Jason.Fragment.new(raw_json)
    HiveGatewayWeb.Endpoint.broadcast!(topic, event, fragment)
  end
end
