defmodule TavokGatewayWeb.UserSocketTest do
  use ExUnit.Case

  alias TavokGatewayWeb.UserSocket

  setup do
    original_secret = Application.get_env(:tavok_gateway, :jwt_secret)
    test_secret = "test-jwt-secret"

    Application.put_env(:tavok_gateway, :jwt_secret, test_secret)

    on_exit(fn ->
      if original_secret do
        Application.put_env(:tavok_gateway, :jwt_secret, original_secret)
      else
        Application.delete_env(:tavok_gateway, :jwt_secret)
      end
    end)

    {:ok, secret: test_secret}
  end

  describe "verify_token/1" do
    test "rejects completely invalid token string" do
      assert {:error, _reason} = UserSocket.verify_token("not.a.jwt")
    end

    test "rejects JWT signed with wrong key", %{secret: _secret} do
      token =
        sign_hs256(
          %{
            "sub" => "user-1",
            "username" => "alice",
            "displayName" => "Alice",
            "exp" => System.system_time(:second) + 3600
          },
          "wrong-secret-key"
        )

      assert {:error, _reason} = UserSocket.verify_token(token)
    end

    test "rejects empty string token" do
      assert {:error, _reason} = UserSocket.verify_token("")
    end

    test "returns claims with all expected fields on success", %{secret: secret} do
      token =
        sign_hs256(
          %{
            "sub" => "user-42",
            "username" => "bob",
            "displayName" => "Bob Builder",
            "exp" => System.system_time(:second) + 7200
          },
          secret
        )

      assert {:ok, claims} = UserSocket.verify_token(token)
      assert claims["sub"] == "user-42"
      assert claims["username"] == "bob"
      assert claims["displayName"] == "Bob Builder"
      assert is_number(claims["exp"])
    end

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
