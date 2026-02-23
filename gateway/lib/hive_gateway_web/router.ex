defmodule HiveGatewayWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", HiveGatewayWeb do
    pipe_through :api

    get "/health", HealthController, :index
  end
end
