defmodule HiveGatewayWeb.Presence do
  @moduledoc """
  Phoenix Presence tracking for HiveChat.

  Tracks which users are online in which channels.
  Uses CRDTs for distributed presence — no single point of failure.

  See docs/PROTOCOL.md §1 for presence event payloads.
  """
  use Phoenix.Presence,
    otp_app: :hive_gateway,
    pubsub_server: HiveGateway.PubSub
end
