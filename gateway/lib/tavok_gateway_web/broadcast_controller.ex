defmodule TavokGatewayWeb.BroadcastController do
  @moduledoc """
  REST-to-broadcast bridge for non-WebSocket agent connectivity (DEC-0044).

  Accepts authenticated internal requests and broadcasts events to Phoenix
  Channel rooms. This is the convergence point for all non-WebSocket
  connection methods (webhooks, REST polling, SSE, OpenAI-compat).

  All requests require the x-internal-secret header.
  See docs/PROTOCOL.md Section 7 for agent connectivity contracts.
  """
  use TavokGatewayWeb, :controller

  alias TavokGateway.Broadcast

  require Logger

  @doc """
  POST /api/internal/broadcast

  Broadcasts an event to a Phoenix Channel topic.

  Body: {"topic": "room:01HXY...", "event": "message_new", "payload": {...}}

  The payload is pre-serialized via Broadcast.endpoint_broadcast!/3, which
  wraps it in a Jason.Fragment for zero-copy fan-out (DEC-0030).
  """
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
      handle_broadcast(conn, params)
    end
  end

  defp handle_broadcast(conn, %{"topic" => topic, "event" => event, "payload" => payload})
       when is_binary(topic) and is_binary(event) and is_map(payload) do
    Broadcast.endpoint_broadcast!(topic, event, payload)

    Logger.info("Broadcast via REST: topic=#{topic} event=#{event}")

    conn
    |> put_status(200)
    |> json(%{ok: true})
  end

  defp handle_broadcast(conn, _params) do
    conn
    |> put_status(400)
    |> json(%{error: "Required: topic (string), event (string), payload (object)"})
  end
end
