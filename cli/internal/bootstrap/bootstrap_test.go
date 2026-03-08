package bootstrap

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBuildConfigForLocalhost(t *testing.T) {
	secrets := Secrets{
		NextAuthSecret:    "next-auth-secret",
		JWTSecret:         "jwt-secret",
		InternalAPISecret: "internal-secret",
		SecretKeyBase:     "secret-key-base",
		EncryptionKey:     "encryption-key",
		PostgresPassword:  "postgres-password",
	}

	config := BuildConfig("localhost", time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC), secrets)

	if config.NextAuthURL != "http://localhost:5555" {
		t.Fatalf("expected localhost auth URL, got %q", config.NextAuthURL)
	}

	if config.GatewayURL != "ws://localhost:4001/socket" {
		t.Fatalf("expected localhost gateway URL, got %q", config.GatewayURL)
	}
}

func TestRenderEnvIncludesExpectedFields(t *testing.T) {
	secrets := Secrets{
		NextAuthSecret:    "next-auth-secret",
		JWTSecret:         "jwt-secret",
		InternalAPISecret: "internal-secret",
		SecretKeyBase:     "secret-key-base",
		EncryptionKey:     "encryption-key",
		PostgresPassword:  "postgres-password",
	}

	config := BuildConfig("chat.example.com", time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC), secrets)
	output := RenderEnv(config)

	expectedLines := []string{
		"DOMAIN=chat.example.com",
		"NEXTAUTH_URL=https://chat.example.com",
		"NEXT_PUBLIC_GATEWAY_URL=wss://chat.example.com/socket",
		"POSTGRES_PASSWORD=postgres-password",
		"NEXTAUTH_SECRET=next-auth-secret",
		"JWT_SECRET=jwt-secret",
		"INTERNAL_API_SECRET=internal-secret",
		"SECRET_KEY_BASE=secret-key-base",
		"ENCRYPTION_KEY=encryption-key",
	}

	for _, expected := range expectedLines {
		if !strings.Contains(output, expected) {
			t.Fatalf("expected rendered env to contain %q", expected)
		}
	}
}

func TestWriteEnvFileRejectsOverwriteWithoutForce(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")

	if err := os.WriteFile(path, []byte("existing"), 0o600); err != nil {
		t.Fatalf("seed env file: %v", err)
	}

	config := BuildConfig("localhost", time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC), Secrets{})

	err := WriteEnvFile(path, config, false)
	if err == nil {
		t.Fatal("expected overwrite protection error")
	}

	if !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("expected overwrite error, got %v", err)
	}
}
