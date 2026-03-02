defmodule TavokGatewayWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", TavokGatewayWeb do
    pipe_through :api

    get "/health", HealthController, :index
  end

  # Internal APIs — authenticated by x-internal-secret header (DEC-0044)
  # Used by non-WebSocket agent connectivity adapters in Next.js
  scope "/api/internal", TavokGatewayWeb do
    pipe_through :api

    post "/broadcast", BroadcastController, :create
  end
end
