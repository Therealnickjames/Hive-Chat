defmodule HiveGatewayWeb.HealthController do
  @moduledoc "Health check endpoint for Docker and load balancers."
  use Phoenix.Controller, formats: [:json]

  def index(conn, _params) do
    conn
    |> put_status(200)
    |> json(%{
      status: "ok",
      service: "gateway",
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    })
  end
end
