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

  alias HiveGateway.StreamWatchdog
  alias HiveGatewayWeb.Presence
  alias HiveGateway.WebClient

  require Logger

  @impl true
  def join("room:" <> channel_id, params, socket) do
    Logger.info("User #{socket.assigns.user_id} joining room:#{channel_id}")

    case authorize_join(channel_id, socket.assigns.user_id) do
      {:ok} ->
        do_join_room(params, socket, channel_id)

      {:error, reason} ->
        Logger.warning("Join rejected: user=#{socket.assigns.user_id} room=#{channel_id} reason=#{inspect(reason)}")
        {:error, %{reason: "unauthorized"}}
    end
  end

  defp do_join_room(params, socket, channel_id) do
    socket = assign(socket, :channel_id, channel_id)

    # Track presence on join
    send(self(), :after_join)

    # If client provides lastSequence, schedule sync after join completes
    case parse_sequence(Map.get(params, "lastSequence")) do
      {:ok, nil} ->
        {:ok, socket}

      {:ok, parsed_last_sequence} ->
        Logger.info(
          "Reconnection sync requested: channel=#{channel_id} lastSequence=#{parsed_last_sequence}"
        )

        send(self(), {:sync_on_join, parsed_last_sequence})
        {:ok, socket}

      {:error, _} ->
        Logger.warning(
          "Invalid lastSequence in join payload: channel=#{channel_id} payload=#{inspect(Map.get(params, "lastSequence"))}"
        )

        send(self(), {:sync_on_join, 0})
        {:ok, socket}
    end
  end

  defp authorize_join(channel_id, user_id) do
    case WebClient.check_channel_membership(channel_id, user_id) do
      {:ok, %{"isMember" => true}} ->
        {:ok}

      {:ok, %{"isMember" => false}} ->
        {:error, :not_member}

      _ ->
        {:error, :membership_check_failed}
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
    case parse_sequence(last_sequence) do
      {:ok, parsed_last_sequence} ->
        case WebClient.get_messages(%{
               channelId: socket.assigns.channel_id,
               afterSequence: parsed_last_sequence,
               limit: 100
             }) do
          {:ok, body} ->
            push(socket, "sync_response", body)

          {:error, _reason} ->
            push(socket, "sync_response", %{"messages" => [], "hasMore" => false})
        end

      {:error, _} ->
        push(socket, "sync_response", %{
          error: %{reason: "invalid_payload", event: "sync_on_join"},
          messages: [],
          hasMore: false
        })
    end

    {:noreply, socket}
  end

  @impl true
  def handle_info({:check_bot_trigger, trigger_message_id, content}, socket) do
    channel_id = socket.assigns.channel_id

    # Run bot trigger check in a separate Task to avoid blocking the channel process.
    # The channel process handles ALL messages for this room — blocking it with HTTP calls
    # would freeze message delivery for every user in the channel. (ISSUE-007)
    Task.Supervisor.async_nolink(HiveGateway.TaskSupervisor, fn ->
      case WebClient.get_channel_bot(channel_id) do
        {:ok, nil} ->
          # No default bot for this channel
          :noop

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
            run_bot_trigger(socket, bot_config, trigger_message_id)
          end

        {:error, reason} ->
          Logger.error("Failed to fetch channel bot: #{inspect(reason)}")
      end
    end)

    {:noreply, socket}
  end

  # Handle Task completion/failure — we don't need the result
  @impl true
  def handle_info({ref, _result}, socket) when is_reference(ref) do
    Process.demonitor(ref, [:flush])
    {:noreply, socket}
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, _pid, _reason}, socket) do
    {:noreply, socket}
  end

  # Maximum message content length (matches PROTOCOL.md constraint)
  @max_content_length 4000

  @impl true
  def handle_in("new_message", %{"content" => content}, socket) when is_binary(content) do
    cond do
      String.trim(content) == "" ->
        {:reply, {:error, %{reason: "empty_content"}}, socket}

      String.length(content) > @max_content_length ->
        {:reply, {:error, %{reason: "content_too_long", max: @max_content_length}}, socket}

      true ->
    channel_id = socket.assigns.channel_id
    user_id = socket.assigns.user_id
    display_name = socket.assigns.display_name

    # 1. Generate ULID for the message
    message_id = Ulid.generate()

    # 2. Get next sequence number with Redis-backed monotonic recovery
    case next_sequence(channel_id) do
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
          sequence: Integer.to_string(sequence)
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
              sequence: Integer.to_string(sequence),
              createdAt: DateTime.utc_now() |> DateTime.to_iso8601()
            }

            # 6. Broadcast to all clients in channel
            broadcast!(socket, "message_new", message_payload)

            # 7. Check for bot trigger (async — don't delay the reply)
            send(self(), {:check_bot_trigger, message_id, content})

            # 8. Reply to sender with message id and sequence
            {:reply, {:ok, %{id: message_id, sequence: Integer.to_string(sequence)}}, socket}

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
  end

  @impl true
  def handle_in("new_message", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "new_message"}}, socket}
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
    case parse_sequence(last_sequence) do
      {:ok, parsed_last_sequence} ->
        case WebClient.get_messages(%{
               channelId: socket.assigns.channel_id,
               afterSequence: parsed_last_sequence,
               limit: 100
             }) do
          {:ok, body} ->
            push(socket, "sync_response", body)

          {:error, _reason} ->
            push(socket, "sync_response", %{"messages" => [], "hasMore" => false})
        end

      {:error, _} ->
        push(socket, "sync_response", %{
          error: %{reason: "invalid_payload", event: "sync"},
          messages: [],
          hasMore: false
        })
    end

    {:noreply, socket}
  end

  @impl true
  def handle_in("sync", _payload, socket) do
    push(socket, "sync_response", %{
      error: %{reason: "invalid_payload", event: "sync"},
      messages: [],
      hasMore: false
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("history", params, socket) when is_map(params) do
    before = Map.get(params, "before")
    case parse_limit(Map.get(params, "limit")) do
      {:error, _} ->
        push(socket, "history_response", %{
          error: %{reason: "invalid_payload", event: "history"},
          messages: [],
          hasMore: false
        })

        {:noreply, socket}

      {:ok, limit} ->
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
  end

  @impl true
  def handle_in("history", _payload, socket) do
    push(socket, "history_response", %{
      error: %{reason: "invalid_payload", event: "history"},
      messages: [],
      hasMore: false
    })

    {:noreply, socket}
  end

  # ---------- Bot trigger helpers ----------

  defp run_bot_trigger(socket, bot_config, trigger_message_id) do
    channel_id = socket.assigns.channel_id
    bot_id = Map.get(bot_config, "id")
    bot_name = Map.get(bot_config, "name")
    bot_avatar_url = Map.get(bot_config, "avatarUrl")

    # 1. Generate ULID for the streaming placeholder
    message_id = Ulid.generate()

    # 2. Get next sequence number with Redis-backed monotonic recovery
    case next_sequence(channel_id) do
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
          sequence: Integer.to_string(sequence)
        }

        case WebClient.post_message(placeholder) do
          {:ok, _response} ->
            # 4. Broadcast stream_start to all clients
            HiveGatewayWeb.Endpoint.broadcast!("room:#{channel_id}", "stream_start", %{
              messageId: message_id,
              botId: bot_id,
              botName: bot_name,
              botAvatarUrl: bot_avatar_url,
              sequence: Integer.to_string(sequence)
            })

            # Register fallback watchdog in case terminal status is missed on Redis pub/sub.
            StreamWatchdog.register_stream(channel_id, message_id)

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

          {:error, reason} ->
            Logger.error("Failed to persist streaming placeholder: #{inspect(reason)}")
        end

      {:error, reason} ->
        Logger.error("Redis INCR failed for streaming message: #{inspect(reason)}")
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

  defp next_sequence(channel_id) do
    # Redis INCR is atomic and creates the key with value 1 if it doesn't exist.
    # No need for GET → SET NX → INCR dance which has a race condition on the
    # first message in a channel. (ISSUE-026)
    #
    # For channels that already have messages in the DB but no Redis key (e.g.,
    # after a Redis restart), we first try INCR. If the key was missing, Redis
    # creates it at 1 — but the DB may already have higher sequences. We detect
    # this case and seed properly.
    key = "hive:channel:#{channel_id}:seq"

    case Redix.command(:redix, ["INCR", key]) do
      {:ok, 1} ->
        # Key was just created — check if DB has higher sequences and seed if needed
        case channel_seed_sequence(channel_id) do
          {:ok, 0} ->
            # Fresh channel, sequence 1 is correct
            {:ok, 1}

          {:ok, seed} when seed >= 1 ->
            # DB has existing messages — set Redis to seed value and increment
            case Redix.command(:redix, ["SET", key, Integer.to_string(seed)]) do
              {:ok, _} ->
                case Redix.command(:redix, ["INCR", key]) do
                  {:ok, sequence} -> {:ok, sequence}
                  error -> error
                end

              error ->
                error
            end

          {:error, reason} ->
            {:error, reason}
        end

      {:ok, sequence} ->
        {:ok, sequence}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def parse_sequence(nil), do: {:ok, nil}

  def parse_sequence(value) when is_integer(value) and value >= 0 do
    {:ok, value}
  end

  def parse_sequence(value) when is_binary(value) do
    case Integer.parse(value) do
      {num, ""} when num >= 0 ->
        {:ok, num}

      _ ->
        {:error, :invalid_sequence}
    end
  end

  def parse_sequence(_), do: {:error, :invalid_sequence}

  def parse_limit(nil), do: {:ok, 50}
  def parse_limit(value) when is_integer(value) and value > 0 do
    {:ok, min(value, 100)}
  end

  def parse_limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {num, ""} when num > 0 ->
        {:ok, min(num, 100)}

      _ ->
        {:error, :invalid_limit}
    end
  end

  def parse_limit(_), do: {:error, :invalid_limit}

  defp channel_seed_sequence(channel_id) do
    case WebClient.get_channel_info(channel_id) do
      {:ok, %{"lastSequence" => last_sequence}} ->
        normalize_sequence(last_sequence)

      {:ok, _} ->
        {:ok, 0}

      {:error, _reason} ->
        {:error, :channel_seed_failed}
    end
  end

  defp normalize_sequence(nil), do: {:ok, 0}

  defp normalize_sequence(value) when is_integer(value) do
    {:ok, max(value, 0)}
  end

  defp normalize_sequence(value) when is_binary(value) do
    case Integer.parse(value) do
      {num, ""} -> {:ok, max(num, 0)}
      _ -> {:error, :invalid_sequence}
    end
  end

  defp normalize_sequence(value) when is_float(value) do
    {:ok, max(round(value), 0)}
  end

  defp normalize_sequence(_), do: {:error, :invalid_sequence}
end
