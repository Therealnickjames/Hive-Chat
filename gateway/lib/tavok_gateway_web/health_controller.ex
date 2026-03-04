defmodule TavokGatewayWeb.HealthController do
  @moduledoc "Health check endpoint for Docker and load balancers."
  use Phoenix.Controller, formats: [:json]
  require Logger

  @check_timeout_ms 500

  def index(conn, _params) do
    checks = %{
      redis: check_redis(),
      web: check_web_health()
    }

    status =
      if Enum.all?(checks, fn {_name, check} -> check["status"] == "ok" end), do: 200, else: 503

    response_status = if status == 200, do: "ok", else: "degraded"

    conn
    |> put_status(status)
    |> json(%{
      status: response_status,
      service: "gateway",
      checks: checks,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    })
  end

  defp check_redis do
    case Redix.command(:redix, ["PING"]) do
      {:ok, "PONG"} ->
        %{"status" => "ok"}

      {:ok, response} ->
        %{"status" => "unhealthy", "details" => "Unexpected Redis response: #{inspect(response)}"}

      {:error, reason} ->
        Logger.error("Redis health check failed: #{inspect(reason)}")
        %{"status" => "unhealthy", "details" => "Redis connection failed"}
    end
  end

  defp check_web_health do
    web_url = Application.get_env(:tavok_gateway, :web_url, "http://localhost:3000")
    health_url = web_url <> "/api/health"

    case Req.get(health_url, receive_timeout: @check_timeout_ms) do
      {:ok, %Req.Response{status: 200}} ->
        %{"status" => "ok"}

      {:ok, %Req.Response{status: status}} ->
        Logger.warning("Web health check returned status #{status}")
        %{"status" => "unhealthy", "details" => "Gateway dependency returned status #{status}"}

      {:error, reason} ->
        Logger.error("Web health check failed: #{inspect(reason)}")
        %{"status" => "unhealthy", "details" => "Web dependency unreachable"}
    end
  end
end
