defmodule TavokGatewayWeb.DmChannel do
  @moduledoc """
  Channel handler for direct messages. (TASK-0019)

  Topic: "dm:{dmChannelId}"

  Handles:
  - Join with optional lastSequence for reconnection sync
  - new_message — user sends a DM
  - message_edit — user edits own message
  - message_delete — user deletes own message
  - typing — user is typing
  - sync — request missed messages
  - history — request older messages

  No bot/agent/streaming support — DMs are human-only.
  See docs/PROTOCOL.md for event payloads.
  """
  use Phoenix.Channel

  alias TavokGateway.Broadcast
  alias TavokGatewayWeb.Presence
  alias TavokGateway.WebClient

  # Server-side typing throttle (matches RoomChannel)
  @typing_throttle_ms 2_000

  # Maximum message content length (matches PROTOCOL.md)
  @max_content_length 4000

  require Logger

  # ---- Join ----

  @impl true
  def join("dm:" <> dm_id, params, socket) do
    user_id = socket.assigns.user_id

    # Only humans can join DM channels
    if socket.assigns[:author_type] == "BOT" do
      {:error, %{reason: "bots_cannot_join_dms"}}
    else
      case authorize_join(dm_id, user_id) do
        {:ok, other_user} ->
          socket =
            socket
            |> assign(:dm_id, dm_id)
            |> assign(:other_user, other_user)

          # Track presence
          send(self(), :after_join)

          # Handle reconnection sync
          case parse_sequence(Map.get(params, "lastSequence")) do
            {:ok, nil} ->
              {:ok, socket}

            {:ok, parsed_last_sequence} ->
              send(self(), {:sync_on_join, parsed_last_sequence})
              {:ok, socket}

            {:error, _} ->
              send(self(), {:sync_on_join, 0})
              {:ok, socket}
          end

        {:error, reason} ->
          Logger.warning(
            "DM join rejected: user=#{user_id} dm=#{dm_id} reason=#{inspect(reason)}"
          )

          {:error, %{reason: "unauthorized"}}
      end
    end
  end

  defp authorize_join(dm_id, user_id) do
    case WebClient.verify_dm_participant(dm_id, user_id) do
      {:ok, %{"valid" => true, "otherUser" => other_user}} ->
        {:ok, other_user}

      {:ok, %{"valid" => false}} ->
        {:error, :not_participant}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # ---- Lifecycle ----

  @impl true
  def handle_info(:after_join, socket) do
    {:ok, _} =
      Presence.track(socket, socket.assigns.user_id, %{
        username: socket.assigns.username,
        display_name: socket.assigns.display_name,
        status: "online",
        online_at: System.system_time(:second)
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  def handle_info({:sync_on_join, last_sequence}, socket) do
    dm_id = socket.assigns.dm_id

    case WebClient.get_dm_messages(%{dmId: dm_id, afterSequence: last_sequence, limit: 100}) do
      {:ok, %{"messages" => messages}} when is_list(messages) ->
        if length(messages) > 0 do
          push(socket, "sync_messages", %{messages: messages})
          Logger.info("DM sync: dm=#{dm_id} delivered=#{length(messages)}")
        end

      {:error, reason} ->
        Logger.error("DM sync failed: dm=#{dm_id} reason=#{inspect(reason)}")
    end

    {:noreply, socket}
  end

  # Catch-all for async task results (from Task.Supervisor.async_nolink in persist)
  @impl true
  def handle_info({ref, _result}, socket) when is_reference(ref) do
    Process.demonitor(ref, [:flush])
    {:noreply, socket}
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, _pid, _reason}, socket) do
    {:noreply, socket}
  end

  @impl true
  def terminate(_reason, socket) do
    Logger.info("DM channel left: user=#{socket.assigns.user_id} dm=#{socket.assigns[:dm_id]}")
    :ok
  end

  # ---- Messages ----

  @impl true
  def handle_in("new_message", %{"content" => content}, socket) when is_binary(content) do
    cond do
      String.trim(content) == "" ->
        {:reply, {:error, %{reason: "empty_content"}}, socket}

      String.length(content) > @max_content_length ->
        {:reply, {:error, %{reason: "content_too_long", max: @max_content_length}}, socket}

      true ->
        handle_dm_message(content, socket)
    end
  end

  def handle_in("new_message", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload"}}, socket}
  end

  # ---- Typing ----

  @impl true
  def handle_in("typing", _payload, socket) do
    now = System.system_time(:millisecond)
    last_typing = socket.assigns[:last_typing_at] || 0

    if now - last_typing >= @typing_throttle_ms do
      Broadcast.broadcast_pre_serialized!(socket, "typing", %{
        userId: socket.assigns.user_id,
        username: socket.assigns.username,
        displayName: socket.assigns.display_name
      })

      {:noreply, assign(socket, :last_typing_at, now)}
    else
      {:noreply, socket}
    end
  end

  # ---- Edit ----

  @impl true
  def handle_in("message_edit", %{"messageId" => message_id, "content" => content}, socket)
      when is_binary(message_id) and is_binary(content) do
    if String.trim(content) == "" do
      {:reply, {:error, %{reason: "empty_content"}}, socket}
    else
      case WebClient.edit_dm_message(message_id, %{content: content}) do
        {:ok, %{"id" => id, "content" => new_content, "editedAt" => edited_at}} ->
          Broadcast.broadcast_pre_serialized!(socket, "message_edited", %{
            messageId: id,
            content: new_content,
            editedAt: edited_at
          })

          {:reply, {:ok, %{messageId: id}}, socket}

        {:error, reason} ->
          Logger.error("DM edit failed: message=#{message_id} reason=#{inspect(reason)}")
          {:reply, {:error, %{reason: "edit_failed"}}, socket}
      end
    end
  end

  def handle_in("message_edit", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload"}}, socket}
  end

  # ---- Delete ----

  @impl true
  def handle_in("message_delete", %{"messageId" => message_id}, socket)
      when is_binary(message_id) do
    case WebClient.delete_dm_message(message_id) do
      {:ok, _} ->
        Broadcast.broadcast_pre_serialized!(socket, "message_deleted", %{
          messageId: message_id,
          deletedBy: socket.assigns.user_id
        })

        {:reply, {:ok, %{messageId: message_id}}, socket}

      {:error, reason} ->
        Logger.error("DM delete failed: message=#{message_id} reason=#{inspect(reason)}")
        {:reply, {:error, %{reason: "delete_failed"}}, socket}
    end
  end

  def handle_in("message_delete", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload"}}, socket}
  end

  # ---- Sync ----

  @impl true
  def handle_in("sync", %{"lastSequence" => last_sequence}, socket) do
    dm_id = socket.assigns.dm_id

    case parse_sequence(last_sequence) do
      {:ok, parsed} when not is_nil(parsed) ->
        case WebClient.get_dm_messages(%{dmId: dm_id, afterSequence: parsed, limit: 100}) do
          {:ok, %{"messages" => messages}} ->
            {:reply, {:ok, %{messages: messages}}, socket}

          {:error, _} ->
            {:reply, {:error, %{reason: "sync_failed"}}, socket}
        end

      _ ->
        {:reply, {:error, %{reason: "invalid_sequence"}}, socket}
    end
  end

  def handle_in("sync", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload"}}, socket}
  end

  # ---- History ----

  @impl true
  def handle_in("history", params, socket) when is_map(params) do
    dm_id = socket.assigns.dm_id
    before = Map.get(params, "before")
    limit = Map.get(params, "limit", 50)

    query = %{dmId: dm_id, before: before, limit: min(limit, 100)}

    case WebClient.get_dm_messages(query) do
      {:ok, %{"messages" => messages, "hasMore" => has_more}} ->
        {:reply, {:ok, %{messages: messages, hasMore: has_more}}, socket}

      {:error, _} ->
        {:reply, {:error, %{reason: "history_failed"}}, socket}
    end
  end

  def handle_in("history", _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload"}}, socket}
  end

  # ---- Private Helpers ----

  defp handle_dm_message(content, socket) do
    dm_id = socket.assigns.dm_id
    user_id = socket.assigns.user_id

    ulid = Ulid.generate()

    case next_sequence(dm_id) do
      {:ok, sequence} ->
        seq_str = Integer.to_string(sequence)

        # Broadcast to all participants
        Broadcast.broadcast_pre_serialized!(socket, "message_new", %{
          id: ulid,
          dmId: dm_id,
          authorId: user_id,
          authorType: "USER",
          authorName: socket.assigns.display_name,
          authorAvatarUrl: nil,
          content: content,
          type: "STANDARD",
          streamingStatus: nil,
          sequence: seq_str,
          createdAt: DateTime.utc_now() |> DateTime.to_iso8601(),
          editedAt: nil,
          reactions: []
        })

        # Persist in background
        Task.Supervisor.async_nolink(TavokGateway.TaskSupervisor, fn ->
          case WebClient.post_dm_message(%{
                 id: ulid,
                 dmId: dm_id,
                 authorId: user_id,
                 content: content,
                 sequence: seq_str
               }) do
            {:ok, _} ->
              Logger.debug("DM message persisted: dm=#{dm_id} message=#{ulid}")

            {:error, reason} ->
              Logger.error(
                "DM persist failed: dm=#{dm_id} message=#{ulid} reason=#{inspect(reason)}"
              )
          end
        end)

        {:reply, {:ok, %{messageId: ulid, sequence: seq_str}}, socket}

      {:error, reason} ->
        Logger.error("Redis INCR failed for DM: #{inspect(reason)}")
        {:reply, {:error, %{reason: "sequence_failed"}}, socket}
    end
  end

  defp next_sequence(dm_id) do
    redis_key = "hive:dm:#{dm_id}:seq"

    case Redix.command(:redix, ["INCR", redis_key]) do
      {:ok, seq} -> {:ok, seq}
      {:error, reason} -> {:error, reason}
    end
  end

  defp parse_sequence(nil), do: {:ok, nil}
  defp parse_sequence(value) when is_integer(value), do: {:ok, value}

  defp parse_sequence(value) when is_binary(value) do
    case Integer.parse(value) do
      {int, ""} -> {:ok, int}
      _ -> {:error, :invalid_sequence}
    end
  end

  defp parse_sequence(_), do: {:error, :invalid_sequence}
end
