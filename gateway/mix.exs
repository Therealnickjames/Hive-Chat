defmodule HiveGateway.MixProject do
  use Mix.Project

  def project do
    [
      app: :hive_gateway,
      version: "0.1.0",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      releases: releases()
    ]
  end

  def application do
    [
      extra_applications: [:logger, :runtime_tools],
      mod: {HiveGateway.Application, []}
    ]
  end

  defp deps do
    [
      # Web framework — WebSocket handling via Channels
      {:phoenix, "~> 1.7"},
      {:phoenix_pubsub, "~> 2.1"},

      # JSON encoding
      {:jason, "~> 1.4"},

      # HTTP server
      {:bandit, "~> 1.5"},

      # JWT validation (for cross-service auth — DEC-0003)
      {:joken, "~> 2.6"},

      # Redis client (for pub/sub and sequence numbers — DEC-0005)
      {:redix, "~> 1.5"},

      # CORS support
      {:cors_plug, "~> 3.0"},

      # ULID generation
      {:ulid, "~> 0.2"}
    ]
  end

  defp releases do
    [
      hive_gateway: [
        applications: [runtime_tools: :permanent]
      ]
    ]
  end
end
