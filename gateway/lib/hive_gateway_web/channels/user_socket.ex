defmodule HiveGatewayWeb.UserSocket do
  @moduledoc """
  WebSocket handler for all client connections.

  Authentication:
  - Client connects with ?token=<JWT> query parameter
  - JWT is validated using the shared JWT_SECRET (DEC-0003)
  - On success: socket assigns user_id, username, display_name
  - On failure: connection rejected

  See docs/PROTOCOL.md §1 for the full WebSocket protocol.
  """
  use Phoenix.Socket

  require Logger

  # Channel routing — topic patterns mapped to channel modules
  channel "room:*", HiveGatewayWeb.RoomChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case verify_token(token) do
      {:ok, claims} ->
        socket =
          socket
          |> assign(:user_id, claims["sub"])
          |> assign(:username, claims["username"])
          |> assign(:display_name, claims["displayName"])

        Logger.info("WebSocket connected: user=#{claims["sub"]}")
        {:ok, socket}

      {:error, reason} ->
        Logger.warning("WebSocket auth failed: #{inspect(reason)}")
        :error
    end
  end

  # No token provided
  def connect(_params, _socket, _connect_info) do
    Logger.warning("WebSocket connection rejected: no token")
    :error
  end

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.user_id}"

  # Verify JWT token using shared secret
  @doc false
  def verify_token(token) do
    jwt_secret = Application.get_env(:hive_gateway, :jwt_secret, "dev-jwt-secret")

    signer = Joken.Signer.create("HS256", jwt_secret)

    case Joken.verify(token, signer) do
      {:ok, claims} ->
        # Check expiry
        case claims do
          %{"exp" => exp} when is_number(exp) ->
            if exp > System.system_time(:second) do
              {:ok, claims}
            else
              {:error, :token_expired}
            end

          _ ->
            {:error, :missing_exp}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end
end
