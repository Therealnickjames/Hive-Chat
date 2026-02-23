defmodule HiveGatewayWeb.RoomChannel do
  @moduledoc """
  Channel handler for chat rooms.

  Topic: "room:{channelId}"

  Handles:
  - Join with optional lastSequence for reconnection sync
  - new_message — user sends a chat message
  - typing — user is typing
  - sync — request missed messages
  - history — request older messages

  See docs/PROTOCOL.md §1 for event payloads.
  """
  use Phoenix.Channel

  alias HiveGatewayWeb.Presence

  require Logger

  @impl true
  def join("room:" <> channel_id, params, socket) do
    Logger.info(
      "User #{socket.assigns.user_id} joining room:#{channel_id}"
    )

    socket = assign(socket, :channel_id, channel_id)

    # Track presence on join
    send(self(), :after_join)

    # If client provides lastSequence, handle reconnection sync
    case Map.get(params, "lastSequence") do
      nil ->
        {:ok, socket}

      last_sequence ->
        # TODO: Fetch missed messages from Next.js internal API
        # For now, just acknowledge the join
        Logger.info(
          "Reconnection sync requested: channel=#{channel_id} lastSequence=#{last_sequence}"
        )

        {:ok, socket}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    # Track this user's presence in the channel
    {:ok, _} =
      Presence.track(socket, socket.assigns.user_id, %{
        username: socket.assigns.username,
        display_name: socket.assigns.display_name,
        online_at: inspect(System.system_time(:second)),
        status: "online"
      })

    # Push current presence state to the joining user
    push(socket, "presence_state", Presence.list(socket))

    {:noreply, socket}
  end

  @impl true
  def handle_in("new_message", %{"content" => content}, socket) do
    # TODO: Implement in TASK-0003
    # 1. Generate ULID for message
    # 2. Get next sequence number from Redis INCR
    # 3. Persist via POST /api/internal/messages
    # 4. Broadcast message_new to all clients
    # 5. Check if channel has a default bot and trigger if needed

    Logger.info(
      "Message received: channel=#{socket.assigns.channel_id} user=#{socket.assigns.user_id} content_length=#{String.length(content)}"
    )

    {:reply, {:ok, %{status: "received"}}, socket}
  end

  @impl true
  def handle_in("typing", _payload, socket) do
    # Broadcast typing indicator to other users in the channel
    broadcast_from(socket, "user_typing", %{
      userId: socket.assigns.user_id,
      username: socket.assigns.username,
      displayName: socket.assigns.display_name
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("sync", %{"lastSequence" => _last_sequence}, socket) do
    # TODO: Implement reconnection sync in TASK-0003
    push(socket, "sync_response", %{messages: [], hasMore: false})
    {:noreply, socket}
  end

  @impl true
  def handle_in("history", params, socket) do
    # TODO: Implement message history in TASK-0003
    _before = Map.get(params, "before")
    _limit = Map.get(params, "limit", 50)

    push(socket, "history_response", %{messages: [], hasMore: false})
    {:noreply, socket}
  end
end
