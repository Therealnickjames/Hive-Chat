defmodule TavokGatewayWeb.UserSocket do
  @moduledoc """
  WebSocket handler for all client connections.

  Authentication (two paths):
  1. Human (JWT):     ?token=<JWT>         — validated locally via shared JWT_SECRET (DEC-0003)
  2. Agent (API key): ?api_key=sk-tvk-...  — verified via internal API call to Next.js (DEC-0040)

  On success, socket assigns:
  - :user_id      — User.id (humans) or Bot.id (agents)
  - :username     — human username or agent display name
  - :display_name — human display name or agent display name
  - :author_type  — "USER" (humans) or "BOT" (agents)
  - :server_id    — (agents only) the server the agent belongs to

  See docs/PROTOCOL.md §1 for the full WebSocket protocol.
  """
  use Phoenix.Socket

  alias TavokGateway.WebClient

  require Logger

  # Channel routing — topic patterns mapped to channel modules
  channel "room:*", TavokGatewayWeb.RoomChannel
  # TASK-0019: Direct messages
  channel "dm:*", TavokGatewayWeb.DmChannel

  # ---- Path 1: Human auth via JWT ----

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case verify_token(token) do
      {:ok, claims} ->
        user_id = claims["sub"]
        username = claims["username"]
        display_name = claims["displayName"]

        # Validate required claims are present and non-empty
        if is_binary(user_id) and byte_size(user_id) > 0 and
             is_binary(username) and byte_size(username) > 0 and
             is_binary(display_name) and byte_size(display_name) > 0 do
          socket =
            socket
            |> assign(:user_id, user_id)
            |> assign(:username, username)
            |> assign(:display_name, display_name)
            |> assign(:author_type, "USER")

          Logger.info("WebSocket connected: user=#{user_id}")
          {:ok, socket}
        else
          Logger.warning(
            "WebSocket auth failed: missing required claims (sub, username, displayName)"
          )

          :error
        end

      {:error, reason} ->
        Logger.warning("WebSocket auth failed: #{inspect(reason)}")
        :error
    end
  end

  # ---- Path 2: Agent auth via API key (DEC-0040) ----

  def connect(%{"api_key" => api_key}, socket, _connect_info) do
    case verify_api_key(api_key) do
      {:ok, agent_info} ->
        socket =
          socket
          |> assign(:user_id, agent_info["botId"])
          |> assign(:username, agent_info["botName"])
          |> assign(:display_name, agent_info["botName"])
          |> assign(:author_type, "BOT")
          |> assign(:server_id, agent_info["serverId"])
          |> assign(:bot_avatar_url, agent_info["botAvatarUrl"])

        Logger.info(
          "WebSocket connected: agent=#{agent_info["botId"]} server=#{agent_info["serverId"]}"
        )

        {:ok, socket}

      {:error, reason} ->
        Logger.warning("Agent WebSocket auth failed: #{inspect(reason)}")
        :error
    end
  end

  # No token or api_key provided
  def connect(_params, _socket, _connect_info) do
    Logger.warning("WebSocket connection rejected: no token or api_key")
    :error
  end

  @impl true
  def id(socket) do
    prefix = if socket.assigns[:author_type] == "BOT", do: "agent_socket", else: "user_socket"
    "#{prefix}:#{socket.assigns.user_id}"
  end

  # ---- Token verification ----

  @doc false
  def verify_token(token) do
    jwt_secret = Application.get_env(:tavok_gateway, :jwt_secret)

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

  # ---- API key verification (DEC-0040) ----

  defp verify_api_key(api_key) when is_binary(api_key) do
    if not String.starts_with?(api_key, "sk-tvk-") do
      {:error, :invalid_key_format}
    else
      case WebClient.verify_agent_api_key(api_key) do
        {:ok, %{"valid" => true} = info} ->
          {:ok, info}

        {:ok, %{"valid" => false, "error" => reason}} ->
          {:error, reason}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp verify_api_key(_), do: {:error, :invalid_key}
end
