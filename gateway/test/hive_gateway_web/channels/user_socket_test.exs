defmodule HiveGatewayWeb.UserSocketTest do
  use ExUnit.Case

  alias HiveGatewayWeb.UserSocket

  setup do
    original_secret = Application.get_env(:hive_gateway, :jwt_secret)
    test_secret = "test-jwt-secret"

    Application.put_env(:hive_gateway, :jwt_secret, test_secret)

    on_exit(fn ->
      if original_secret do
        Application.put_env(:hive_gateway, :jwt_secret, original_secret)
      else
        Application.delete_env(:hive_gateway, :jwt_secret)
      end
    end)

    {:ok, secret: test_secret}
  end

  describe "verify_token/1" do
    test "rejects JWT without exp claim", %{secret: secret} do
      token =
        sign_hs256(
          %{
            "sub" => "user-1",
            "username" => "alice",
            "displayName" => "Alice"
          },
          secret
        )

      assert UserSocket.verify_token(token) == {:error, :missing_exp}
    end

    test "rejects JWT with expired exp", %{secret: secret} do
      token =
        sign_hs256(
          %{
            "sub" => "user-1",
            "username" => "alice",
            "displayName" => "Alice",
            "exp" => System.system_time(:second) - 3600
          },
          secret
        )

      assert UserSocket.verify_token(token) == {:error, :token_expired}
    end

    test "accepts JWT with valid future exp", %{secret: secret} do
      token =
        sign_hs256(
          %{
            "sub" => "user-1",
            "username" => "alice",
            "displayName" => "Alice",
            "exp" => System.system_time(:second) + 3600
          },
          secret
        )

      assert {:ok, claims} = UserSocket.verify_token(token)
      assert claims["sub"] == "user-1"
      assert claims["username"] == "alice"
      assert claims["displayName"] == "Alice"
    end
  end

  defp sign_hs256(payload, secret) do
    header_part = %{"alg" => "HS256", "typ" => "JWT"} |> Jason.encode!() |> base64url()
    payload_part = payload |> Jason.encode!() |> base64url()
    data = "#{header_part}.#{payload_part}"
    signature_part = :crypto.mac(:hmac, :sha256, secret, data) |> base64url()
    "#{data}.#{signature_part}"
  end

  defp base64url(data) do
    Base.url_encode64(data, padding: false)
  end
end
