defmodule TavokGatewayWeb.RoomChannel do
  @moduledoc """
  Channel handler for chat rooms.

  Topic: "room:{channelId}"

  Handles:
  - Join with optional lastSequence for reconnection sync
  - new_message — user sends a chat message
  - message_edit — user edits own message (TASK-0014)
  - message_delete — user deletes a message (TASK-0014)
  - typing — user is typing
  - sync — request missed messages
  - history — request older messages

  See docs/PROTOCOL.md §1 for event payloads.
  """
  use Phoenix.Channel

  alias TavokGateway.Broadcast
  alias TavokGateway.StreamWatchdog
  alias TavokGateway.MessagePersistence
  alias TavokGateway.MessageBuffer
  alias TavokGateway.ConfigCache
  alias TavokGateway.RateLimiter
  alias TavokGatewayWeb.Presence
  alias TavokGateway.WebClient

  # Server-side typing throttle: silently drop typing events within this window (DEC-0031)
  @typing_throttle_ms 2_000

  require Logger

  @impl true
  def join("room:" <> channel_id, params, socket) do
    Logger.info("#{socket.assigns[:author_type] || "USER"} #{socket.assigns.user_id} joining room:#{channel_id}")

    case authorize_join(channel_id, socket) do
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

  defp authorize_join(channel_id, socket) do
    case socket.assigns[:author_type] do
      "BOT" ->
        # Agents can join any channel in their server (DEC-0040)
        # The agent's server_id was set during WebSocket connect auth
        authorize_agent_join(channel_id, socket.assigns[:server_id])

      _ ->
        # Humans use membership check (existing flow)
        authorize_human_join(channel_id, socket.assigns.user_id)
    end
  end

  defp authorize_human_join(channel_id, user_id) do
    case ConfigCache.get_channel_membership(channel_id, user_id) do
      {:ok, %{"isMember" => true}} ->
        {:ok}

      {:ok, %{"isMember" => false}} ->
        {:error, :not_member}

      _ ->
        {:error, :membership_check_failed}
    end
  end

  defp authorize_agent_join(channel_id, agent_server_id) do
    # Verify the channel belongs to the agent's server (DEC-0040)
    # Uses WebClient directly — agent joins are infrequent (once per connection)
    case WebClient.get_channel_info(channel_id) do
      {:ok, %{"serverId" => server_id}} when server_id == agent_server_id ->
        {:ok}

      {:ok, %{"serverId" => _other_server}} ->
        {:error, :agent_wrong_server}

      _ ->
        {:error, :channel_lookup_failed}
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
        # 1. Get buffered messages (covers async-persistence gap, DEC-0051)
        buffered =
          MessageBuffer.get_messages_after(
            socket.assigns.channel_id,
            parsed_last_sequence
          )

        # 2. Get DB messages (covers messages older than buffer TTL)
        db_messages =
          case WebClient.get_messages(%{
                 channelId: socket.assigns.channel_id,
                 afterSequence: parsed_last_sequence,
                 limit: 100
               }) do
            {:ok, %{"messages" => msgs}} -> msgs
            {:ok, _} -> []
            {:error, _reason} -> []
          end

        # 3. Merge: union by message ID, buffer wins on conflict (fresher data)
        db_map =
          Map.new(db_messages, fn m ->
            id = Map.get(m, "id") || Map.get(m, :id)
            {id, m}
          end)

        buffer_map =
          Map.new(buffered, fn m ->
            id = Map.get(m, :id) || Map.get(m, "id")

            # Convert atom-key map to string-key map for consistent shape
            string_map =
              for {k, v} <- m, into: %{} do
                {to_string(k), v}
              end

            {id, string_map}
          end)

        merged_map = Map.merge(db_map, buffer_map)

        merged_messages =
          merged_map
          |> Map.values()
          |> Enum.sort_by(fn m ->
            seq = Map.get(m, "sequence") || Map.get(m, :sequence) || "0"

            case Integer.parse(to_string(seq)) do
              {n, ""} -> n
              _ -> 0
            end
          end)

        push(socket, "sync_response", %{
          "messages" => merged_messages,
          "hasMore" => false
        })

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
    Task.Supervisor.async_nolink(TavokGateway.TaskSupervisor, fn ->
      # Multi-bot: try ChannelBot join table first, fall back to single defaultBot (TASK-0012)
      case ConfigCache.get_channel_bots(channel_id) do
        {:ok, bots} when is_list(bots) and length(bots) > 0 ->
          # Evaluate trigger condition for each bot independently
          any_triggered =
            Enum.reduce(bots, false, fn bot_config, acc ->
              maybe_trigger_bot(socket, bot_config, trigger_message_id, content) or acc
            end)

          maybe_emit_trigger_hint(socket, bots, content, any_triggered)

        {:ok, _empty} ->
          # No bots in ChannelBot table — fall back to single defaultBot (backward compat)
          case ConfigCache.get_channel_bot(channel_id) do
            {:ok, nil} ->
              :noop

            {:ok, bot_config} ->
              any_triggered = maybe_trigger_bot(socket, bot_config, trigger_message_id, content)
              maybe_emit_trigger_hint(socket, [bot_config], content, any_triggered)

            {:error, reason} ->
              Logger.error("Failed to fetch channel bot: #{inspect(reason)}")
          end

        {:error, reason} ->
          Logger.error("Failed to fetch channel bots: #{inspect(reason)}")
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

    # 0. Per-channel rate limit check (DEC-0035)
    case RateLimiter.check_and_increment(channel_id) do
      {:error, :rate_limited} ->
        {:reply, {:error, %{reason: "rate_limited"}}, socket}

      :ok ->
    user_id = socket.assigns.user_id
    display_name = socket.assigns.display_name

    # 1. Generate ULID for the message
    message_id = Ulid.generate()

    # 2. Get next sequence number with Redis-backed monotonic recovery
    case next_sequence(channel_id) do
      {:ok, sequence} ->
        seq_str = Integer.to_string(sequence)

        # 3. Broadcast immediately — payload built from in-memory data only
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
          sequence: seq_str,
          createdAt: DateTime.utc_now() |> DateTime.to_iso8601()
        }

        Broadcast.broadcast_pre_serialized!(socket, "message_new", message_payload)

        # 3b. Buffer for reconnection sync gap (DEC-0051)
        MessageBuffer.buffer_message(channel_id, message_payload)

        # 4. Check for bot trigger (async — don't delay the reply)
        send(self(), {:check_bot_trigger, message_id, content})

        # 5. Persist in background — never blocks the channel process
        persist_body = %{
          id: message_id,
          channelId: channel_id,
          authorId: user_id,
          authorType: "USER",
          content: content,
          type: "STANDARD",
          streamingStatus: nil,
          sequence: seq_str
        }

        MessagePersistence.persist_async(persist_body, message_id, channel_id)

        # 6. Reply to sender immediately
        {:reply, {:ok, %{id: message_id, sequence: seq_str}}, socket}

      {:error, reason} ->
        Logger.error("Redis INCR failed: #{inspect(reason)}")
        {:reply, {:error, %{reason: "sequence_failed"}}, socket}
    end
    end
    end
  end

  @impl true
  def handle_in("new_message", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "new_message"}}, socket}
  end

  @impl true
  def handle_in("typing", _payload, socket) do
    # Server-side typing throttle: cap at 1 broadcast per @typing_throttle_ms per user.
    # At 1000 users, this prevents 50 typists × 10 keystrokes/sec = 500k frames/sec.
    now = System.system_time(:millisecond)
    last = socket.assigns[:last_typing_at]

    if is_nil(last) or now - last >= @typing_throttle_ms do
      Broadcast.broadcast_from_pre_serialized!(socket, "user_typing", %{
        userId: socket.assigns.user_id,
        username: socket.assigns.username,
        displayName: socket.assigns.display_name
      })

      {:noreply, assign(socket, :last_typing_at, now)}
    else
      # Silently drop — client-side already has its own throttle (DEC-0014)
      {:noreply, socket}
    end
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

        db_messages =
          case WebClient.get_messages(query_params) do
            {:ok, %{"messages" => msgs}} -> msgs
            {:ok, body} when is_map(body) -> Map.get(body, "messages", [])
            {:error, _reason} -> []
          end

        # Merge with ETS buffer for recently broadcast messages (DEC-0051)
        # History doesn't use afterSequence, so get all buffered messages
        buffered = MessageBuffer.get_messages_after(socket.assigns.channel_id, 0)

        buffer_map =
          Map.new(buffered, fn m ->
            id = Map.get(m, :id) || Map.get(m, "id")
            string_map = for {k, v} <- m, into: %{}, do: {to_string(k), v}
            {id, string_map}
          end)

        db_map =
          Map.new(db_messages, fn m ->
            id = Map.get(m, "id") || Map.get(m, :id)
            {id, m}
          end)

        merged =
          Map.merge(db_map, buffer_map)
          |> Map.values()
          |> Enum.sort_by(fn m ->
            seq = Map.get(m, "sequence") || Map.get(m, :sequence) || "0"
            case Integer.parse(to_string(seq)) do
              {n, ""} -> n
              _ -> 0
            end
          end)
          |> Enum.take(-limit)

        push(socket, "history_response", %{
          "messages" => merged,
          "hasMore" => length(merged) >= limit
        })

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

  # ---------- Message Edit (TASK-0014) ----------

  @impl true
  def handle_in("message_edit", %{"messageId" => message_id, "content" => content}, socket)
      when is_binary(message_id) and is_binary(content) do
    trimmed = String.trim(content)

    cond do
      trimmed == "" ->
        {:reply, {:error, %{reason: "empty_content"}}, socket}

      String.length(content) > @max_content_length ->
        {:reply, {:error, %{reason: "content_too_long", max: @max_content_length}}, socket}

      true ->
        user_id = socket.assigns.user_id

        case WebClient.edit_message(message_id, %{userId: user_id, content: content}) do
          {:ok, response} ->
            # Broadcast the edit to all clients in the room
            Broadcast.broadcast_pre_serialized!(socket, "message_edited", %{
              messageId: Map.get(response, "messageId"),
              content: Map.get(response, "content"),
              editedAt: Map.get(response, "editedAt")
            })

            {:reply, {:ok, %{messageId: Map.get(response, "messageId")}}, socket}

          {:error, {:http_error, 403, _body}} ->
            {:reply, {:error, %{reason: "not_author"}}, socket}

          {:error, {:http_error, 404, _body}} ->
            {:reply, {:error, %{reason: "not_found"}}, socket}

          {:error, {:http_error, 409, _body}} ->
            {:reply, {:error, %{reason: "stream_active"}}, socket}

          {:error, reason} ->
            Logger.error("message_edit failed: #{inspect(reason)}")
            {:reply, {:error, %{reason: "edit_failed"}}, socket}
        end
    end
  end

  @impl true
  def handle_in("message_edit", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "message_edit"}}, socket}
  end

  # ---------- Message Delete (TASK-0014) ----------

  @impl true
  def handle_in("message_delete", %{"messageId" => message_id}, socket)
      when is_binary(message_id) do
    user_id = socket.assigns.user_id

    case WebClient.delete_message(message_id, %{userId: user_id}) do
      {:ok, response} ->
        # Broadcast the deletion to all clients in the room
        Broadcast.broadcast_pre_serialized!(socket, "message_deleted", %{
          messageId: Map.get(response, "messageId"),
          deletedBy: Map.get(response, "deletedBy")
        })

        {:reply, {:ok, %{messageId: Map.get(response, "messageId")}}, socket}

      {:error, {:http_error, 403, _body}} ->
        {:reply, {:error, %{reason: "unauthorized"}}, socket}

      {:error, {:http_error, 404, _body}} ->
        {:reply, {:error, %{reason: "not_found"}}, socket}

      {:error, reason} ->
        Logger.error("message_delete failed: #{inspect(reason)}")
        {:reply, {:error, %{reason: "delete_failed"}}, socket}
    end
  end

  @impl true
  def handle_in("message_delete", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "message_delete"}}, socket}
  end

  # ---------- Charter Control (TASK-0020) ----------
  # Allows channel members with MANAGE_CHANNELS to pause/end charter sessions.
  # Delegates to the Web API: POST /api/servers/{serverId}/channels/{channelId}/charter

  @valid_charter_actions ~w(pause end)

  @impl true
  def handle_in("charter_control", %{"action" => action}, socket)
      when action in @valid_charter_actions do
    channel_id = socket.assigns.channel_id

    # Fetch channel info to get serverId for the API call
    case WebClient.get_channel_info(channel_id) do
      {:ok, %{"serverId" => server_id}} ->
        Task.Supervisor.async_nolink(TavokGateway.TaskSupervisor, fn ->
          case WebClient.charter_control(server_id, channel_id, action, socket.assigns.user_id) do
            {:ok, response} ->
              # Broadcast charter_status to all clients in the room
              Broadcast.endpoint_broadcast!("room:#{channel_id}", "charter_status", response)
              Logger.info("Charter #{action}: channel=#{channel_id}")

            {:error, reason} ->
              Logger.error("Charter control failed: channel=#{channel_id} action=#{action} reason=#{inspect(reason)}")
          end
        end)

        {:reply, {:ok, %{action: action}}, socket}

      {:error, reason} ->
        Logger.error("Charter control channel lookup failed: #{inspect(reason)}")
        {:reply, {:error, %{reason: "channel_lookup_failed"}}, socket}
    end
  end

  @impl true
  def handle_in("charter_control", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "charter_control"}}, socket}
  end

  # ---------- Agent-Originated Streaming (DEC-0040 / Session 2) ----------
  # These handlers allow agents connected via API key to stream tokens
  # directly through the WebSocket, bypassing the Go streaming proxy.
  # Only BOT author_type connections can use these events.

  @impl true
  def handle_in("stream_start", payload, socket) do
    case socket.assigns[:author_type] do
      "BOT" ->
        handle_agent_stream_start(payload, socket)

      _ ->
        {:reply, {:error, %{reason: "only_agents_can_stream"}}, socket}
    end
  end

  @impl true
  def handle_in("stream_token", payload, socket) do
    case socket.assigns[:author_type] do
      "BOT" ->
        handle_agent_stream_token(payload, socket)

      _ ->
        {:reply, {:error, %{reason: "only_agents_can_stream"}}, socket}
    end
  end

  @impl true
  def handle_in("stream_complete", payload, socket) do
    case socket.assigns[:author_type] do
      "BOT" ->
        handle_agent_stream_complete(payload, socket)

      _ ->
        {:reply, {:error, %{reason: "only_agents_can_stream"}}, socket}
    end
  end

  @impl true
  def handle_in("stream_error", payload, socket) do
    case socket.assigns[:author_type] do
      "BOT" ->
        handle_agent_stream_error(payload, socket)

      _ ->
        {:reply, {:error, %{reason: "only_agents_can_stream"}}, socket}
    end
  end

  # Also handle stream_thinking from agents
  @impl true
  def handle_in("stream_thinking", %{"messageId" => message_id, "phase" => phase} = payload, socket) do
    case socket.assigns[:author_type] do
      "BOT" ->
        Broadcast.broadcast_pre_serialized!(socket, "stream_thinking", %{
          messageId: message_id,
          phase: phase,
          detail: Map.get(payload, "detail", ""),
          timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
        })

        {:noreply, socket}

      _ ->
        {:reply, {:error, %{reason: "only_agents_can_stream"}}, socket}
    end
  end

  @impl true
  def handle_in("stream_thinking", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "stream_thinking"}}, socket}
  end

  # ---------- Typed Messages (TASK-0039) ----------
  # Agents can send structured messages (TOOL_CALL, TOOL_RESULT, CODE_BLOCK, ARTIFACT, STATUS)
  # These are standalone messages (not part of a stream) with JSON content.

  @valid_typed_message_types ~w(TOOL_CALL TOOL_RESULT CODE_BLOCK ARTIFACT STATUS)

  @impl true
  def handle_in("typed_message", %{"type" => msg_type, "content" => content} = payload, socket) do
    case socket.assigns[:author_type] do
      "BOT" when msg_type in @valid_typed_message_types ->
        handle_agent_typed_message(msg_type, content, payload, socket)

      "BOT" ->
        {:reply, {:error, %{reason: "invalid_message_type", type: msg_type}}, socket}

      _ ->
        {:reply, {:error, %{reason: "only_agents_can_send_typed_messages"}}, socket}
    end
  end

  @impl true
  def handle_in("typed_message", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "typed_message"}}, socket}
  end

  defp handle_agent_stream_start(_payload, socket) do
    channel_id = socket.assigns.channel_id
    bot_id = socket.assigns.user_id
    bot_name = socket.assigns.display_name
    bot_avatar_url = socket.assigns[:bot_avatar_url]

    message_id = Ulid.generate()

    case next_sequence(channel_id) do
      {:ok, sequence} ->
        seq_str = Integer.to_string(sequence)

        # Broadcast stream_start to all clients
        Broadcast.broadcast_pre_serialized!(socket, "stream_start", %{
          messageId: message_id,
          botId: bot_id,
          botName: bot_name,
          botAvatarUrl: bot_avatar_url,
          sequence: seq_str
        })

        # Persist placeholder message in background
        placeholder = %{
          id: message_id,
          channelId: channel_id,
          authorId: bot_id,
          authorType: "BOT",
          content: "",
          type: "STREAMING",
          streamingStatus: "ACTIVE",
          sequence: seq_str
        }

        MessagePersistence.persist_async(placeholder, message_id, channel_id)

        {:reply, {:ok, %{messageId: message_id, sequence: seq_str}}, socket}

      {:error, reason} ->
        Logger.error("Redis INCR failed for agent stream: #{inspect(reason)}")
        {:reply, {:error, %{reason: "sequence_failed"}}, socket}
    end
  end

  defp handle_agent_stream_token(
         %{"messageId" => message_id, "token" => token, "index" => index},
         socket
       ) do
    # Broadcast token to all clients — no persistence needed per-token
    Broadcast.broadcast_pre_serialized!(socket, "stream_token", %{
      messageId: message_id,
      token: token,
      index: index
    })

    {:noreply, socket}
  end

  defp handle_agent_stream_token(_payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "stream_token"}}, socket}
  end

  defp handle_agent_stream_complete(
         %{"messageId" => message_id, "finalContent" => final_content} = payload,
         socket
       ) do
    channel_id = socket.assigns.channel_id
    thinking_timeline = Map.get(payload, "thinkingTimeline", [])
    metadata = Map.get(payload, "metadata")

    # Finalize the message via internal API (include metadata + thinkingTimeline for persistence)
    update_body = %{
      content: final_content,
      streamingStatus: "COMPLETE"
    }
    update_body = if metadata, do: Map.put(update_body, :metadata, metadata), else: update_body
    update_body = if thinking_timeline != [], do: Map.put(update_body, :thinkingTimeline, Jason.encode!(thinking_timeline)), else: update_body

    Task.Supervisor.async_nolink(TavokGateway.TaskSupervisor, fn ->
      case WebClient.update_message(message_id, update_body) do
        {:ok, _} ->
          Logger.info("Agent stream finalized: channel=#{channel_id} message=#{message_id}")

        {:error, reason} ->
          Logger.error("Failed to finalize agent stream: #{inspect(reason)}")
      end
    end)

    # Broadcast stream_complete to all clients
    complete_payload = %{
      messageId: message_id,
      finalContent: final_content,
      thinkingTimeline: thinking_timeline
    }

    complete_payload =
      if metadata, do: Map.put(complete_payload, :metadata, metadata), else: complete_payload

    Broadcast.broadcast_pre_serialized!(socket, "stream_complete", complete_payload)

    {:reply, {:ok, %{messageId: message_id}}, socket}
  end

  defp handle_agent_stream_complete(_payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "stream_complete"}}, socket}
  end

  defp handle_agent_stream_error(
         %{"messageId" => message_id} = payload,
         socket
       ) do
    channel_id = socket.assigns.channel_id
    error_msg = Map.get(payload, "error", "Unknown error")
    partial_content = Map.get(payload, "partialContent", "")

    # Mark message as errored via internal API
    update_body = %{
      content: partial_content,
      streamingStatus: "ERROR"
    }

    Task.Supervisor.async_nolink(TavokGateway.TaskSupervisor, fn ->
      case WebClient.update_message(message_id, update_body) do
        {:ok, _} ->
          Logger.info("Agent stream error persisted: channel=#{channel_id} message=#{message_id}")

        {:error, reason} ->
          Logger.error("Failed to persist agent stream error: #{inspect(reason)}")
      end
    end)

    # Broadcast stream_error to all clients
    Broadcast.broadcast_pre_serialized!(socket, "stream_error", %{
      messageId: message_id,
      error: error_msg,
      partialContent: partial_content
    })

    {:reply, {:ok, %{messageId: message_id}}, socket}
  end

  defp handle_agent_stream_error(_payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload", event: "stream_error"}}, socket}
  end

  defp handle_agent_typed_message(msg_type, content, payload, socket) do
    channel_id = socket.assigns.channel_id
    bot_id = socket.assigns.user_id
    bot_name = socket.assigns.display_name
    bot_avatar_url = socket.assigns[:bot_avatar_url]
    metadata = Map.get(payload, "metadata")

    message_id = Ulid.generate()

    case next_sequence(channel_id) do
      {:ok, sequence} ->
        seq_str = Integer.to_string(sequence)

        # Encode content as JSON string if it's a map
        content_str =
          if is_map(content) or is_list(content) do
            Jason.encode!(content)
          else
            to_string(content)
          end

        # Build broadcast payload
        broadcast_payload = %{
          id: message_id,
          channelId: channel_id,
          authorId: bot_id,
          authorType: "BOT",
          authorName: bot_name,
          authorAvatarUrl: bot_avatar_url,
          content: content_str,
          type: msg_type,
          streamingStatus: nil,
          sequence: seq_str,
          createdAt: DateTime.utc_now() |> DateTime.to_iso8601(),
          reactions: [],
          metadata: metadata
        }

        # Broadcast to all clients
        Broadcast.broadcast_pre_serialized!(socket, "typed_message", broadcast_payload)

        # Persist in background
        persist_payload = %{
          id: message_id,
          channelId: channel_id,
          authorId: bot_id,
          authorType: "BOT",
          content: content_str,
          type: msg_type,
          streamingStatus: nil,
          sequence: seq_str,
          metadata: metadata
        }

        MessagePersistence.persist_async(persist_payload, message_id, channel_id)

        {:reply, {:ok, %{messageId: message_id, sequence: seq_str}}, socket}

      {:error, reason} ->
        Logger.error("Redis INCR failed for typed message: #{inspect(reason)}")
        {:reply, {:error, %{reason: "sequence_failed"}}, socket}
    end
  end

  # ---------- Bot trigger helpers ----------

  # Evaluate trigger condition and run bot if matched (TASK-0012)
  # Branches on connectionMethod to dispatch via the appropriate channel (DEC-0043)
  defp maybe_trigger_bot(socket, bot_config, trigger_message_id, content) do
    channel_id = socket.assigns.channel_id
    trigger_mode = Map.get(bot_config, "triggerMode", "ALWAYS")
    bot_name = Map.get(bot_config, "name", "")
    bot_id = Map.get(bot_config, "id", "")
    connection_method = Map.get(bot_config, "connectionMethod", "WEBSOCKET")
    has_mention = String.contains?(content, "@#{bot_name}")

    should_trigger =
      case trigger_mode do
        "ALWAYS" -> true
        "MENTION" -> has_mention
        _ -> false
      end

    Logger.info(
      "[TriggerDecision] channel=#{channel_id} bot=#{bot_id} mode=#{trigger_mode} method=#{connection_method} " <>
        "should_trigger=#{should_trigger} has_mention=#{has_mention} content_len=#{String.length(content)}"
    )

    if should_trigger do
      case connection_method do
        "WEBSOCKET" ->
          run_bot_trigger(socket, bot_config, trigger_message_id, content)
          true

        "WEBHOOK" ->
          run_webhook_trigger(socket, bot_config, trigger_message_id, content)
          true

        "REST_POLL" ->
          run_poll_trigger(socket, bot_config, trigger_message_id, content)
          true

        _ ->
          # INBOUND_WEBHOOK, SSE, OPENAI_COMPAT are agent-initiated — no server-side trigger
          Logger.info(
            "[TriggerDecision] channel=#{channel_id} bot=#{bot_id} skipping dispatch for connectionMethod=#{connection_method}"
          )
          false
      end
    else
      false
    end
  end

  defp maybe_emit_trigger_hint(_socket, _bots, _content, true), do: :ok

  defp maybe_emit_trigger_hint(socket, bots, content, false) do
    channel_id = socket.assigns.channel_id

    mention_bot =
      Enum.find(bots, fn bot ->
        trigger_mode = Map.get(bot, "triggerMode", "ALWAYS")
        bot_name = Map.get(bot, "name", "")
        has_name = String.trim(bot_name) != ""
        not_mentioned = not String.contains?(content, "@#{bot_name}")

        trigger_mode == "MENTION" and has_name and not_mentioned
      end)

    if mention_bot do
      Broadcast.endpoint_broadcast!("room:#{channel_id}", "bot_trigger_skipped", %{
        botId: Map.get(mention_bot, "id", ""),
        botName: Map.get(mention_bot, "name", ""),
        triggerMode: "MENTION",
        reason: "mention_required"
      })
    end

    :ok
  end

  defp run_bot_trigger(socket, bot_config, trigger_message_id, trigger_content) do
    channel_id = socket.assigns.channel_id
    bot_id = Map.get(bot_config, "id")
    bot_name = Map.get(bot_config, "name")
    bot_avatar_url = Map.get(bot_config, "avatarUrl")

    # 1. Generate ULID for the streaming placeholder
    message_id = Ulid.generate()

    # 2. Get next sequence number with Redis-backed monotonic recovery
    case next_sequence(channel_id) do
      {:ok, sequence} ->
        seq_str = Integer.to_string(sequence)

        # 3. Broadcast stream_start immediately — no DB dependency
        Broadcast.endpoint_broadcast!("room:#{channel_id}", "stream_start", %{
          messageId: message_id,
          botId: bot_id,
          botName: bot_name,
          botAvatarUrl: bot_avatar_url,
          sequence: seq_str
        })

        # 4. Register fallback watchdog immediately
        StreamWatchdog.register_stream(channel_id, message_id)

        # 5. Persist placeholder in background (concurrent with context fetch)
        placeholder = %{
          id: message_id,
          channelId: channel_id,
          authorId: bot_id,
          authorType: "BOT",
          content: "",
          type: "STREAMING",
          streamingStatus: "ACTIVE",
          sequence: seq_str
        }

        MessagePersistence.persist_async(placeholder, message_id, channel_id)

        # 6. Build context messages for the LLM.
        # Pass trigger message content to guarantee it's included in context.
        # The user's message is persisted async (MessagePersistence.persist_async)
        # and may not be in the DB yet when we fetch context. (ISSUE-027)
        context_messages = fetch_context_messages(channel_id, trigger_content)

        # 7. Publish stream request to Redis for Go Proxy
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
        Logger.error("Redis INCR failed for streaming message: #{inspect(reason)}")
    end
  end

  # Dispatch trigger to agent's webhook URL (DEC-0043: WEBHOOK connectionMethod)
  # The Next.js dispatch endpoint handles HMAC signing, agent HTTP call,
  # and response broadcasting (sync, SSE stream, or async callback).
  defp run_webhook_trigger(socket, bot_config, trigger_message_id, trigger_content) do
    channel_id = socket.assigns.channel_id
    bot_id = Map.get(bot_config, "id")
    context_messages = fetch_context_messages(channel_id, trigger_content)

    Task.Supervisor.async_nolink(TavokGateway.TaskSupervisor, fn ->
      case WebClient.dispatch_webhook(bot_id, %{
             channelId: channel_id,
             triggerMessageId: trigger_message_id,
             triggerContent: trigger_content,
             contextMessages: context_messages
           }) do
        {:ok, _} ->
          Logger.info(
            "Webhook dispatched: channel=#{channel_id} bot=#{bot_id}"
          )

        {:error, reason} ->
          Logger.error(
            "Webhook dispatch failed: channel=#{channel_id} bot=#{bot_id} reason=#{inspect(reason)}"
          )
      end
    end)
  end

  # Enqueue message for REST polling agents (DEC-0043: REST_POLL connectionMethod)
  # The message is queued in AgentMessage table for the agent to pick up
  # via GET /api/v1/agents/{id}/messages.
  defp run_poll_trigger(socket, bot_config, trigger_message_id, trigger_content) do
    channel_id = socket.assigns.channel_id
    bot_id = Map.get(bot_config, "id")

    Task.Supervisor.async_nolink(TavokGateway.TaskSupervisor, fn ->
      case WebClient.enqueue_agent_message(bot_id, %{
             channelId: channel_id,
             messageId: trigger_message_id,
             content: trigger_content,
             authorId: socket.assigns.user_id,
             authorName: socket.assigns.display_name,
             authorType: socket.assigns[:author_type] || "USER"
           }) do
        {:ok, _} ->
          Logger.info(
            "Message enqueued for polling: channel=#{channel_id} bot=#{bot_id}"
          )

        {:error, reason} ->
          Logger.error(
            "Enqueue failed: channel=#{channel_id} bot=#{bot_id} reason=#{inspect(reason)}"
          )
      end
    end)
  end

  defp fetch_context_messages(channel_id, trigger_content) do
    history =
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

            %{"role" => role, "content" => Map.get(m, "content") || ""}
          end)
          # Filter out messages with empty content — prevents cascade where a previous
          # empty LLM response (tokenCount:0 bug) contaminates context and causes
          # subsequent responses to also be empty. (ISSUE-027)
          |> Enum.filter(fn m ->
            content = Map.get(m, "content", "")
            String.trim(content) != ""
          end)

        {:error, _reason} ->
          []
      end

    # Guarantee the trigger message is the last entry in context.
    # The user's message is persisted async and may not be in the DB yet.
    # If it IS already in the DB (appears as the last user message with matching
    # content), skip the append to avoid duplication. (ISSUE-027)
    trigger_msg = %{"role" => "user", "content" => trigger_content}

    already_present =
      case List.last(history) do
        %{"role" => "user", "content" => c} when c == trigger_content -> true
        _ -> false
      end

    if already_present do
      history
    else
      history ++ [trigger_msg]
    end
  end

  # Max retries and base delay for Redis commands during transient disconnections (F-01).
  @redis_retry_attempts 3
  @redis_retry_base_ms 100

  defp next_sequence(channel_id) do
    # Redis INCR is atomic and creates the key with value 1 if it doesn't exist.
    # No need for GET → SET NX → INCR dance which has a race condition on the
    # first message in a channel. (ISSUE-026)
    #
    # For channels that already have messages in the DB but no Redis key (e.g.,
    # after a Redis restart), we first try INCR. If the key was missing, Redis
    # creates it at 1 — but the DB may already have higher sequences. We detect
    # this case and seed properly.
    #
    # All Redis commands use redis_with_retry/1 to survive brief Redix
    # reconnection windows after Redis restarts (F-01).
    key = "hive:channel:#{channel_id}:seq"

    case redis_with_retry(["INCR", key]) do
      {:ok, 1} ->
        # Key was just created — check if DB has higher sequences and seed if needed
        case channel_seed_sequence(channel_id) do
          {:ok, 0} ->
            # Fresh channel, sequence 1 is correct
            {:ok, 1}

          {:ok, seed} when seed >= 1 ->
            # DB has existing messages — set Redis to seed value and increment
            case redis_with_retry(["SET", key, Integer.to_string(seed)]) do
              {:ok, _} ->
                case redis_with_retry(["INCR", key]) do
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

  # Retry Redis commands with exponential backoff during transient disconnections.
  # Covers the Redix reconnection window after Redis restarts (F-01).
  # Max wait: 100 + 200 + 400 = 700ms — well under user-perceptible threshold.
  defp redis_with_retry(command, attempt \\ 0) do
    case Redix.command(:redix, command) do
      {:ok, result} ->
        {:ok, result}

      {:error, reason} when attempt < @redis_retry_attempts ->
        delay = @redis_retry_base_ms * Integer.pow(2, attempt)

        Logger.warning(
          "Redis command failed, retrying: command=#{inspect(command)} " <>
            "attempt=#{attempt}/#{@redis_retry_attempts} delay=#{delay}ms error=#{inspect(reason)}"
        )

        Process.sleep(delay)
        redis_with_retry(command, attempt + 1)

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
