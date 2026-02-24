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
  alias HiveGateway.WebClient

  require Logger

  @impl true
  def join("room:" <> channel_id, params, socket) do
    Logger.info(
      "User #{socket.assigns.user_id} joining room:#{channel_id}"
    )

    socket = assign(socket, :channel_id, channel_id)

    # Track presence on join
    send(self(), :after_join)

    # If client provides lastSequence, schedule sync after join completes
    case Map.get(params, "lastSequence") do
      nil ->
        {:ok, socket}

      last_sequence ->
        Logger.info(
          "Reconnection sync requested: channel=#{channel_id} lastSequence=#{last_sequence}"
        )

        send(self(), {:sync_on_join, last_sequence})
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
  def handle_info({:sync_on_join, last_sequence}, socket) do
    case WebClient.get_messages(%{
           channelId: socket.assigns.channel_id,
           afterSequence: last_sequence,
           limit: 100
         }) do
      {:ok, body} ->
        push(socket, "sync_response", body)

      {:error, _reason} ->
        push(socket, "sync_response", %{"messages" => [], "hasMore" => false})
    end

    {:noreply, socket}
  end

  @impl true
  def handle_info({:check_bot_trigger, trigger_message_id, content}, socket) do
    channel_id = socket.assigns.channel_id

    case WebClient.get_channel_bot(channel_id) do
      {:ok, nil} ->
        # No default bot for this channel
        {:noreply, socket}

      {:ok, bot_config} ->
        trigger_mode = Map.get(bot_config, "triggerMode", "ALWAYS")
        bot_name = Map.get(bot_config, "name", "")

        should_trigger =
          case trigger_mode do
            "ALWAYS" -> true
            "MENTION" -> String.contains?(content, "@#{bot_name}")
            _ -> false
          end

        if should_trigger do
          handle_bot_trigger(socket, bot_config, trigger_message_id)
        else
          {:noreply, socket}
        end

      {:error, reason} ->
        Logger.error("Failed to fetch channel bot: #{inspect(reason)}")
        {:noreply, socket}
    end
  end

  @impl true
  def handle_in("new_message", %{"content" => content}, socket) do
    channel_id = socket.assigns.channel_id
    user_id = socket.assigns.user_id
    display_name = socket.assigns.display_name

    # 1. Generate ULID for the message
    message_id = Ulid.generate()

    # 2. Get next sequence number from Redis INCR
    case Redix.command(:redix, ["INCR", "hive:channel:#{channel_id}:seq"]) do
      {:ok, sequence} ->
        # 3. Build persist request body (matches PersistMessageRequest type)
        body = %{
          id: message_id,
          channelId: channel_id,
          authorId: user_id,
          authorType: "USER",
          content: content,
          type: "STANDARD",
          streamingStatus: nil,
          sequence: sequence
        }

        # 4. Persist via internal API
        case WebClient.post_message(body) do
          {:ok, _response} ->
            # 5. Build MessagePayload for broadcast
            message_payload = %{
              id: message_id,
              channelId: channel_id,
              authorId: user_id,
              authorType: "USER",
              authorName: display_name,
              authorAvatarUrl: nil,
              content: content,
              type: "STANDARD",
              streamingStatus: nil,
              sequence: sequence,
              createdAt: DateTime.utc_now() |> DateTime.to_iso8601()
            }

            # 6. Broadcast to all clients in channel
            broadcast!(socket, "message_new", message_payload)

            # 7. Check for bot trigger (async — don't delay the reply)
            send(self(), {:check_bot_trigger, message_id, content})

            # 8. Reply to sender with message id and sequence
            {:reply, {:ok, %{id: message_id, sequence: sequence}}, socket}

          {:error, reason} ->
            Logger.error(
              "Failed to persist message: channel=#{channel_id} error=#{inspect(reason)}"
            )

            {:reply, {:error, %{reason: "persistence_failed"}}, socket}
        end

      {:error, reason} ->
        Logger.error("Redis INCR failed: #{inspect(reason)}")
        {:reply, {:error, %{reason: "sequence_failed"}}, socket}
    end
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
  def handle_in("sync", %{"lastSequence" => last_sequence}, socket) do
    case WebClient.get_messages(%{
           channelId: socket.assigns.channel_id,
           afterSequence: last_sequence,
           limit: 100
         }) do
      {:ok, body} ->
        push(socket, "sync_response", body)

      {:error, _reason} ->
        push(socket, "sync_response", %{"messages" => [], "hasMore" => false})
    end

    {:noreply, socket}
  end

  @impl true
  def handle_in("history", params, socket) do
    before = Map.get(params, "before")
    limit = min(Map.get(params, "limit", 50), 100)

    query_params = %{channelId: socket.assigns.channel_id, limit: limit}

    query_params =
      if before, do: Map.put(query_params, :before, before), else: query_params

    case WebClient.get_messages(query_params) do
      {:ok, body} ->
        push(socket, "history_response", body)

      {:error, _reason} ->
        push(socket, "history_response", %{"messages" => [], "hasMore" => false})
    end

    {:noreply, socket}
  end

  # ---------- Bot trigger helpers ----------

  defp handle_bot_trigger(socket, bot_config, trigger_message_id) do
    channel_id = socket.assigns.channel_id
    bot_id = Map.get(bot_config, "id")
    bot_name = Map.get(bot_config, "name")
    bot_avatar_url = Map.get(bot_config, "avatarUrl")

    # 1. Generate ULID for the streaming placeholder
    message_id = Ulid.generate()

    # 2. Get next sequence number
    case Redix.command(:redix, ["INCR", "hive:channel:#{channel_id}:seq"]) do
      {:ok, sequence} ->
        # 3. Persist placeholder (type=STREAMING, status=ACTIVE, content="")
        placeholder = %{
          id: message_id,
          channelId: channel_id,
          authorId: bot_id,
          authorType: "BOT",
          content: "",
          type: "STREAMING",
          streamingStatus: "ACTIVE",
          sequence: sequence
        }

        case WebClient.post_message(placeholder) do
          {:ok, _response} ->
            # 4. Broadcast stream_start to all clients
            broadcast!(socket, "stream_start", %{
              messageId: message_id,
              botId: bot_id,
              botName: bot_name,
              botAvatarUrl: bot_avatar_url,
              sequence: sequence
            })

            # 5. Build context messages for the LLM
            context_messages = fetch_context_messages(channel_id)

            # 6. Publish stream request to Redis for Go Proxy
            stream_request =
              Jason.encode!(%{
                channelId: channel_id,
                messageId: message_id,
                botId: bot_id,
                triggerMessageId: trigger_message_id,
                contextMessages: context_messages
              })

            case Redix.command(:redix, ["PUBLISH", "hive:stream:request", stream_request]) do
              {:ok, _} ->
                Logger.info(
                  "Stream request published: channel=#{channel_id} message=#{message_id} bot=#{bot_id}"
                )

              {:error, reason} ->
                Logger.error("Failed to publish stream request: #{inspect(reason)}")
            end

            {:noreply, socket}

          {:error, reason} ->
            Logger.error("Failed to persist streaming placeholder: #{inspect(reason)}")
            {:noreply, socket}
        end

      {:error, reason} ->
        Logger.error("Redis INCR failed for streaming message: #{inspect(reason)}")
        {:noreply, socket}
    end
  end

  defp fetch_context_messages(channel_id) do
    case WebClient.get_messages(%{channelId: channel_id, limit: 20}) do
      {:ok, %{"messages" => messages}} ->
        messages
        |> Enum.filter(fn m ->
          # Include standard messages and completed streaming messages
          Map.get(m, "type") == "STANDARD" or
            (Map.get(m, "type") == "STREAMING" and
               Map.get(m, "streamingStatus") == "COMPLETE")
        end)
        |> Enum.map(fn m ->
          role =
            case Map.get(m, "authorType") do
              "BOT" -> "assistant"
              _ -> "user"
            end

          %{"role" => role, "content" => Map.get(m, "content")}
        end)

      {:error, _reason} ->
        []
    end
  end
end
