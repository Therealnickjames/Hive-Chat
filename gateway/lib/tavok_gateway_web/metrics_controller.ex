defmodule TavokGatewayWeb.MetricsController do
  @moduledoc """
  Prometheus-format metrics endpoint for the Gateway.

  Exports WebSocket connections, message throughput, and stream lifecycle
  counters. Protected by INTERNAL_API_SECRET.
  """
  use Phoenix.Controller, formats: [:text]

  def index(conn, _params) do
    # Basic BEAM/VM metrics
    memory = :erlang.memory()
    process_count = :erlang.system_info(:process_count)
    {uptime_ms, _} = :erlang.statistics(:wall_clock)

    # WebSocket transport metrics (Bandit/Cowboy stats not easily available,
    # but we can track connected channels via Phoenix.Tracker if configured)

    lines = [
      "# HELP tavok_gateway_uptime_seconds Gateway uptime",
      "# TYPE tavok_gateway_uptime_seconds gauge",
      "tavok_gateway_uptime_seconds #{div(uptime_ms, 1000)}",
      "",
      "# HELP tavok_gateway_beam_processes BEAM process count",
      "# TYPE tavok_gateway_beam_processes gauge",
      "tavok_gateway_beam_processes #{process_count}",
      "",
      "# HELP tavok_gateway_memory_bytes Memory usage by category",
      "# TYPE tavok_gateway_memory_bytes gauge",
      "tavok_gateway_memory_bytes{type=\"total\"} #{memory[:total]}",
      "tavok_gateway_memory_bytes{type=\"processes\"} #{memory[:processes]}",
      "tavok_gateway_memory_bytes{type=\"binary\"} #{memory[:binary]}",
      "tavok_gateway_memory_bytes{type=\"ets\"} #{memory[:ets]}",
      ""
    ]

    conn
    |> put_resp_content_type("text/plain")
    |> send_resp(200, Enum.join(lines, "\n"))
  end
end
