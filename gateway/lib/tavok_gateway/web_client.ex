defmodule TavokGateway.WebClient do
  @moduledoc """
  HTTP client for calling Next.js internal APIs.
  All calls include the x-internal-secret header for authentication.
  See docs/PROTOCOL.md §3 for endpoint contracts.
  """

  require Logger
  require OpenTelemetry.Tracer, as: Tracer

  defp web_url do
    Application.get_env(:tavok_gateway, :web_url, "http://localhost:5555")
  end

  defp internal_secret do
    Application.get_env(:tavok_gateway, :internal_api_secret, "dev-internal-secret")
  end

  defp req_headers do
    base = [{"x-internal-secret", internal_secret()}]

    # Inject x-request-id
    base =
      case Logger.metadata()[:request_id] do
        nil -> base
        id -> [{"x-request-id", id} | base]
      end

    # Inject W3C traceparent for distributed tracing
    :otel_propagator_text_map.inject(base, fn headers, key, value ->
      [{key, value} | headers]
    end)
  end

  # Wraps an HTTP call in an OpenTelemetry span.
  defp traced_call(span_name, attrs \\ [], fun) do
    Tracer.with_span span_name, %{kind: :client, attributes: attrs} do
      fun.()
    end
  end

  @doc """
  Persist a message via POST /api/internal/messages.
  Returns {:ok, response_body} or {:error, reason}.
  """
  def post_message(body) do
    traced_call(
      "web_client.post_message",
      %{"http.method": "POST", "http.url": "/api/internal/messages"},
      fn ->
        url = "#{web_url()}/api/internal/messages"

        case Req.post(url,
               json: body,
               headers: req_headers(),
               receive_timeout: 10_000
             ) do
          {:ok, %Req.Response{status: 201, body: response_body}} ->
            {:ok, response_body}

          {:ok, %Req.Response{status: status, body: response_body}} ->
            Logger.error("post_message failed: status=#{status} body=#{inspect(response_body)}")
            {:error, {:http_error, status, response_body}}

          {:error, reason} ->
            Logger.error("post_message request failed: #{inspect(reason)}")
            {:error, reason}
        end
      end
    )
  end

  @doc """
  Get the default agent config for a channel.
  Returns {:ok, agent_config} or {:ok, nil} (no agent) or {:error, reason}.
  """
  def get_channel_agent(channel_id) do
    url = "#{web_url()}/api/internal/channels/#{channel_id}/agent"

    case Req.get(url,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: 404}} ->
        {:ok, nil}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("get_channel_agent failed: status=#{status} body=#{inspect(response_body)}")

        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("get_channel_agent request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Get ALL agents assigned to a channel (multi-agent — TASK-0012).
  Returns {:ok, [agent_config, ...]} or {:ok, []} (no agents) or {:error, reason}.
  Falls back to defaultAgent if no ChannelAgent entries exist.
  """
  def get_channel_agents(channel_id) do
    url = "#{web_url()}/api/internal/channels/#{channel_id}/agents"

    case Req.get(url,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: %{"agents" => agents}}} ->
        {:ok, agents}

      {:ok, %Req.Response{status: 200, body: _}} ->
        {:ok, []}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("get_channel_agents failed: status=#{status} body=#{inspect(response_body)}")

        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("get_channel_agents request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch channel metadata for authorization and sequence fallback.
  Returns {:ok, %{serverId: ..., lastSequence: ..., isMember: ...}} or {:error, reason}.
  """
  def get_channel_info(channel_id) do
    url = "#{web_url()}/api/internal/channels/#{channel_id}"

    case Req.get(url,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("get_channel_info failed: status=#{status} body=#{inspect(response_body)}")
        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("get_channel_info request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch the charter text for a channel.
  GET /api/internal/channels/{channelId} and extracts charter fields.
  Returns {:ok, charter_text} or {:ok, nil} or {:error, reason}.
  """
  def get_channel_charter(channel_id) do
    case get_channel_info(channel_id) do
      {:ok, %{"charter" => charter}} when is_binary(charter) ->
        {:ok, charter}

      {:ok, %{"charterText" => charter}} when is_binary(charter) ->
        {:ok, charter}

      {:ok, _} ->
        {:ok, nil}

      {:error, _reason} = error ->
        error
    end
  end

  @doc """
  Check whether a user is a member of a channel's parent server.
  Query params include `userId`.
  Returns {:ok, %{isMember: bool}} or {:error, reason}.
  """
  def check_channel_membership(channel_id, user_id) do
    url = "#{web_url()}/api/internal/channels/#{channel_id}"

    case Req.get(url,
           params: [{"userId", user_id}],
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error(
          "check_channel_membership failed: channel=#{channel_id} status=#{status} body=#{inspect(response_body)}"
        )

        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("check_channel_membership request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch messages via GET /api/internal/messages.
  Params: %{channelId: string, afterSequence?: string | int, before?: string, limit?: int}
  Returns {:ok, %{messages: [...], hasMore: bool}} or {:error, reason}.
  """
  def get_messages(params) do
    url = "#{web_url()}/api/internal/messages"

    # Build query params, filtering out nil values
    query_params =
      params
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Enum.map(fn {k, v} -> {to_string(k), to_string(v)} end)

    case Req.get(url,
           params: query_params,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("get_messages failed: status=#{status} body=#{inspect(response_body)}")
        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("get_messages request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch one message via GET /api/internal/messages/{messageId}.
  Returns {:ok, message} | {:ok, nil} (404) | {:error, reason}.
  """
  def get_message(message_id) do
    url = "#{web_url()}/api/internal/messages/#{message_id}"

    case Req.get(url,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: 404}} ->
        {:ok, nil}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("get_message failed: status=#{status} body=#{inspect(response_body)}")
        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("get_message request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Update a message's streaming status via PUT /api/internal/messages/{messageId}.
  Used by StreamWatchdog to force-terminate stuck ACTIVE streams.
  Returns {:ok, response_body} | {:error, reason}.
  """
  def update_message(message_id, update_body) do
    url = "#{web_url()}/api/internal/messages/#{message_id}"

    case Req.put(url,
           json: update_body,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("update_message failed: status=#{status} body=#{inspect(response_body)}")
        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("update_message request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Edit a message's content via PATCH /api/internal/messages/{messageId}.
  The internal API validates ownership and streaming status. (TASK-0014)
  Returns {:ok, %{messageId, content, editedAt}} | {:error, reason}.
  """
  def edit_message(message_id, body) do
    url = "#{web_url()}/api/internal/messages/#{message_id}"

    case Req.patch(url,
           json: body,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.warning("edit_message rejected: status=#{status} body=#{inspect(response_body)}")
        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("edit_message request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Soft-delete a message via DELETE /api/internal/messages/{messageId}.
  The internal API validates ownership and MANAGE_MESSAGES permission. (TASK-0014)
  Returns {:ok, %{messageId, deletedBy}} | {:error, reason}.
  """
  def delete_message(message_id, body) do
    url = "#{web_url()}/api/internal/messages/#{message_id}"

    case Req.delete(url,
           json: body,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.warning("delete_message rejected: status=#{status} body=#{inspect(response_body)}")

        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("delete_message request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Dispatch a webhook trigger to Next.js for outbound delivery (DEC-0043).
  POST /api/internal/agents/{agentId}/dispatch
  Next.js handles HMAC signing, calling the agent's webhookUrl, and
  broadcasting the response back to the channel.
  Returns {:ok, response_body} | {:error, reason}.
  """
  def dispatch_webhook(agent_id, payload) do
    traced_call(
      "web_client.dispatch_webhook",
      %{"http.method": "POST", "tavok.agent_id": agent_id},
      fn ->
        url = "#{web_url()}/api/internal/agents/#{agent_id}/dispatch"

        case Req.post(url,
               json: payload,
               headers: req_headers(),
               receive_timeout: 35_000
             ) do
          {:ok, %Req.Response{status: status, body: response_body}}
          when status in [200, 201, 202] ->
            {:ok, response_body}

          {:ok, %Req.Response{status: status, body: response_body}} ->
            Logger.error(
              "dispatch_webhook failed: agent=#{agent_id} status=#{status} body=#{inspect(response_body)}"
            )

            {:error, {:http_error, status, response_body}}

          {:error, reason} ->
            Logger.error(
              "dispatch_webhook request failed: agent=#{agent_id} reason=#{inspect(reason)}"
            )

            {:error, reason}
        end
      end
    )
  end

  @doc """
  Enqueue a message for a REST polling agent (DEC-0043).
  POST /api/internal/agents/{agentId}/enqueue
  The message is queued in the AgentMessage table for the agent to pick up
  via GET /api/v1/agents/{id}/messages.
  Returns {:ok, response_body} | {:error, reason}.
  """
  def enqueue_agent_message(agent_id, payload) do
    url = "#{web_url()}/api/internal/agents/#{agent_id}/enqueue"

    case Req.post(url,
           json: payload,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 201, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error(
          "enqueue_agent_message failed: agent=#{agent_id} status=#{status} body=#{inspect(response_body)}"
        )

        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error(
          "enqueue_agent_message request failed: agent=#{agent_id} reason=#{inspect(reason)}"
        )

        {:error, reason}
    end
  end

  # ---- Direct Message API (TASK-0019) ----

  @doc """
  Verify a user is a participant in a DM channel.
  GET /api/internal/dms/verify?dmId=X&userId=Y
  Returns {:ok, %{valid: true/false, ...}} or {:error, reason}.
  """
  def verify_dm_participant(dm_id, user_id) do
    url = "#{web_url()}/api/internal/dms/verify"

    case Req.get(url,
           params: [{"dmId", dm_id}, {"userId", user_id}],
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error(
          "verify_dm_participant failed: status=#{status} body=#{inspect(response_body)}"
        )

        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("verify_dm_participant request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Persist a DM message via POST /api/internal/dms/messages.
  Returns {:ok, response_body} or {:error, reason}.
  """
  def post_dm_message(body) do
    url = "#{web_url()}/api/internal/dms/messages"

    case Req.post(url,
           json: body,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("post_dm_message failed: status=#{status} body=#{inspect(response_body)}")
        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("post_dm_message request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch DM messages via GET /api/internal/dms/messages.
  Returns {:ok, %{messages: [...], hasMore: bool}} or {:error, reason}.
  """
  def get_dm_messages(params) do
    url = "#{web_url()}/api/internal/dms/messages"

    query_params =
      params
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Enum.map(fn {k, v} -> {to_string(k), to_string(v)} end)

    case Req.get(url,
           params: query_params,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("get_dm_messages failed: status=#{status} body=#{inspect(response_body)}")
        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("get_dm_messages request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Edit a DM message via PATCH /api/internal/dms/messages/{messageId}.
  Returns {:ok, response_body} or {:error, reason}.
  """
  def edit_dm_message(message_id, body) do
    url = "#{web_url()}/api/internal/dms/messages/#{message_id}"

    case Req.patch(url,
           json: body,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.warning(
          "edit_dm_message rejected: status=#{status} body=#{inspect(response_body)}"
        )

        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("edit_dm_message request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Soft-delete a DM message via DELETE /api/internal/dms/messages/{messageId}.
  Returns {:ok, response_body} or {:error, reason}.
  """
  def delete_dm_message(message_id, body) do
    url = "#{web_url()}/api/internal/dms/messages/#{message_id}"

    case Req.delete(url,
           json: body,
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.warning(
          "delete_dm_message rejected: status=#{status} body=#{inspect(response_body)}"
        )

        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("delete_dm_message request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Verify an agent API key via GET /api/internal/agents/verify.
  Returns {:ok, agent_info} or {:error, reason}. (DEC-0040)
  """
  def verify_agent_api_key(api_key) do
    traced_call(
      "web_client.verify_agent_api_key",
      %{"http.method": "GET", "http.url": "/api/internal/agents/verify"},
      fn ->
        url = "#{web_url()}/api/internal/agents/verify"

        case Req.get(url,
               params: [{"api_key", api_key}],
               headers: req_headers(),
               receive_timeout: 10_000
             ) do
          {:ok, %Req.Response{status: 200, body: response_body}} ->
            {:ok, response_body}

          {:ok, %Req.Response{status: status, body: response_body}} when status in [401, 404] ->
            Logger.debug("verify_agent_api_key rejected: status=#{status}")

            {:error, {:http_error, status, response_body}}

          {:ok, %Req.Response{status: status, body: response_body}} ->
            Logger.warning(
              "verify_agent_api_key failed: status=#{status} body=#{inspect(response_body)}"
            )

            {:error, {:http_error, status, response_body}}

          {:error, reason} ->
            Logger.error("verify_agent_api_key request failed: #{inspect(reason)}")
            {:error, reason}
        end
      end
    )
  end

  @doc """
  Control charter session via POST /api/internal/channels/{channelId}/charter-control.
  Called by RoomChannel when a user sends a charter_control event. (TASK-0020)

  The internal route re-checks server membership and MANAGE_CHANNELS using
  the provided user_id so websocket actions stay aligned with REST auth.
  """
  def charter_control(channel_id, action, user_id) do
    url = "#{web_url()}/api/internal/channels/#{channel_id}/charter-control"

    case Req.post(url,
           json: %{action: action, userId: user_id},
           headers: req_headers(),
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("charter_control failed: status=#{status} body=#{inspect(response_body)}")
        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("charter_control request failed: #{inspect(reason)}")
        {:error, reason}
    end
  end
end
