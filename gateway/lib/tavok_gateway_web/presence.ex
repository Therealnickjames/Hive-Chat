defmodule TavokGatewayWeb.Presence do
  @moduledoc """
  Phoenix Presence tracking for Tavok.

  Tracks which users are online in which channels.
  Uses CRDTs for distributed presence — no single point of failure.

  See docs/PROTOCOL.md §1 for presence event payloads.
  """
  use Phoenix.Presence,
    otp_app: :tavok_gateway,
    pubsub_server: TavokGateway.PubSub
end
