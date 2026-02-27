defmodule HiveGatewayWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :hive_gateway

  # WebSocket transport for Phoenix Channels
  socket "/socket", HiveGatewayWeb.UserSocket,
    websocket: [
      timeout: 45_000,
      compress: true
    ],
    longpoll: false

  # CORS support
  plug CORSPlug,
    origin: ["*"],
    methods: ["GET", "POST"],
    headers: ["*"]

  # Parse JSON bodies for internal API
  plug Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason

  # Request ID for correlation
  plug Plug.RequestId

  # Logger
  plug Plug.Logger

  # Router
  plug HiveGatewayWeb.Router
end
