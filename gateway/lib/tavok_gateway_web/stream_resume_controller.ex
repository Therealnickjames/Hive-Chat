defmodule TavokGatewayWeb.StreamResumeController do
  @moduledoc """
  Publishes stream resume requests to Redis for the Go streaming proxy. (TASK-0021)

  POST /api/internal/stream-resume
  Body: {channelId, originalMessageId, agentId, agentName, checkpointIndex, checkpointLabel, partialContent}

  The Go proxy subscribes to hive:stream:resume and restarts streaming
  from the specified checkpoint.
  """
  use TavokGatewayWeb, :controller

  require Logger

  def create(conn, params) do
    internal_secret = Application.get_env(:tavok_gateway, :internal_api_secret)

    provided_secret =
      conn
      |> get_req_header("x-internal-secret")
      |> List.first()

    if provided_secret != internal_secret do
      conn
      |> put_status(401)
      |> json(%{error: "Unauthorized"})
    else
      handle_resume(conn, params)
    end
  end

  defp handle_resume(
         conn,
         %{
           "channelId" => channel_id,
           "originalMessageId" => original_message_id,
           "agentId" => agent_id,
           "agentName" => agent_name,
           "checkpointIndex" => checkpoint_index,
           "checkpointLabel" => checkpoint_label,
           "partialContent" => partial_content
         }
       )
       when is_binary(channel_id) and is_binary(original_message_id) and is_binary(agent_id) do
    resume_request =
      Jason.encode!(%{
        channelId: channel_id,
        originalMessageId: original_message_id,
        agentId: agent_id,
        agentName: agent_name,
        checkpointIndex: checkpoint_index,
        checkpointLabel: checkpoint_label,
        partialContent: partial_content
      })

    case Redix.command(:redix, ["PUBLISH", "hive:stream:resume", resume_request]) do
      {:ok, _} ->
        Logger.info(
          "Stream resume published: channel=#{channel_id} message=#{original_message_id} agent=#{agent_id} checkpoint=#{checkpoint_index}"
        )

        conn
        |> put_status(200)
        |> json(%{ok: true})

      {:error, reason} ->
        Logger.error("Failed to publish stream resume: #{inspect(reason)}")

        conn
        |> put_status(500)
        |> json(%{error: "Failed to publish resume request"})
    end
  end

  defp handle_resume(conn, _params) do
    conn
    |> put_status(400)
    |> json(%{
      error:
        "Required: channelId, originalMessageId, agentId, agentName, checkpointIndex, checkpointLabel, partialContent"
    })
  end
end
