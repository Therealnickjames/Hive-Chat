defmodule HiveGateway.LogFormatter do
  @moduledoc """
  JSON log formatter for production.

  Safely handles Erlang iodata/chardata message shapes that Phoenix, Bandit,
  and OTP may emit.
  """

  @spec format(Logger.level(), Logger.message(), Logger.Formatter.time(), keyword()) :: iodata()
  def format(level, message, {date, time}, metadata) do
    timestamp = format_timestamp(date, time)
    msg = safe_to_string(message)

    base_log_entry = %{
      time: timestamp,
      level: to_string(level),
      msg: msg
    }

    log_entry =
      Enum.reduce(metadata, base_log_entry, fn {key, value}, acc ->
        Map.put(acc, key, safe_to_string(value))
      end)

    case Jason.encode(log_entry) do
      {:ok, json} -> [json, "\n"]
      {:error, _reason} -> ["[", to_string(level), "] ", msg, "\n"]
    end
  end

  defp format_timestamp({year, month, day}, {hour, minute, second}) do
    :io_lib.format("~4..0B-~2..0B-~2..0BT~2..0B:~2..0B:~2..0B", [
      year,
      month,
      day,
      hour,
      minute,
      second
    ])
    |> IO.iodata_to_binary()
  end

  defp format_timestamp({year, month, day}, {hour, minute, second, _fraction}) do
    :io_lib.format("~4..0B-~2..0B-~2..0BT~2..0B:~2..0B:~2..0B", [
      year,
      month,
      day,
      hour,
      minute,
      second
    ])
    |> IO.iodata_to_binary()
  end

  defp safe_to_string(msg) when is_binary(msg), do: msg

  defp safe_to_string(msg) when is_list(msg) do
    try do
      IO.iodata_to_binary(msg)
    rescue
      _ -> inspect(msg)
    end
  end

  defp safe_to_string({format, args}) when is_list(args) do
    format_value =
      if is_binary(format) do
        String.to_charlist(format)
      else
        format
      end

    try do
      format_value
      |> :io_lib.format(args)
      |> IO.iodata_to_binary()
    rescue
      _ -> inspect({format, args})
    end
  end

  defp safe_to_string(msg), do: inspect(msg)
end
