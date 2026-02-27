defmodule HiveGateway.WebClient do
  @moduledoc """
  HTTP client for calling Next.js internal APIs.
  All calls include the x-internal-secret header for authentication.
  See docs/PROTOCOL.md §3 for endpoint contracts.
  """

  require Logger

  defp web_url do
    Application.get_env(:hive_gateway, :web_url, "http://localhost:3000")
  end

  defp internal_secret do
    Application.get_env(:hive_gateway, :internal_api_secret, "dev-internal-secret")
  end

  @doc """
  Persist a message via POST /api/internal/messages.
  Returns {:ok, response_body} or {:error, reason}.
  """
  def post_message(body) do
    url = "#{web_url()}/api/internal/messages"

    case Req.post(url,
           json: body,
           headers: [{"x-internal-secret", internal_secret()}],
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

  @doc """
  Get the default bot config for a channel.
  Returns {:ok, bot_config} or {:ok, nil} (no bot) or {:error, reason}.
  """
  def get_channel_bot(channel_id) do
    url = "#{web_url()}/api/internal/channels/#{channel_id}/bot"

    case Req.get(url,
           headers: [{"x-internal-secret", internal_secret()}],
           receive_timeout: 10_000
         ) do
      {:ok, %Req.Response{status: 200, body: response_body}} ->
        {:ok, response_body}

      {:ok, %Req.Response{status: 404}} ->
        {:ok, nil}

      {:ok, %Req.Response{status: status, body: response_body}} ->
        Logger.error("get_channel_bot failed: status=#{status} body=#{inspect(response_body)}")
        {:error, {:http_error, status, response_body}}

      {:error, reason} ->
        Logger.error("get_channel_bot request failed: #{inspect(reason)}")
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
           headers: [{"x-internal-secret", internal_secret()}],
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
  Check whether a user is a member of a channel's parent server.
  Query params include `userId`.
  Returns {:ok, %{isMember: bool}} or {:error, reason}.
  """
  def check_channel_membership(channel_id, user_id) do
    url = "#{web_url()}/api/internal/channels/#{channel_id}"

    case Req.get(url,
           params: [{"userId", user_id}],
           headers: [{"x-internal-secret", internal_secret()}],
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
           headers: [{"x-internal-secret", internal_secret()}],
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
           headers: [{"x-internal-secret", internal_secret()}],
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
           headers: [{"x-internal-secret", internal_secret()}],
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
end
