defmodule TavokGatewayWeb.CacheController do
  @moduledoc """
  Internal cache invalidation endpoint for testing and operational use.
  Protected by x-internal-secret header.
  """
  use Phoenix.Controller, formats: [:json]

  alias TavokGateway.ConfigCache

  def invalidate(conn, %{"channelId" => channel_id}) do
    ConfigCache.invalidate_channel(channel_id)

    conn
    |> put_status(200)
    |> json(%{ok: true, invalidated: channel_id})
  end

  def invalidate(conn, _params) do
    conn
    |> put_status(400)
    |> json(%{error: "channelId is required"})
  end
end
