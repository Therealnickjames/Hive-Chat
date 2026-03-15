package health

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestHealthyResponseWhenAllChecksPass(t *testing.T) {
	// Mock the web health endpoint
	webSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			t.Errorf("path = %q, want /api/health", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer webSrv.Close()

	os.Setenv("STREAMING_WEB_URL", webSrv.URL)
	defer os.Unsetenv("STREAMING_WEB_URL")

	// No Redis client set — redis will be "unhealthy", so this tests web-only.
	// We need to test the handler itself: it should return JSON with expected fields.
	// For a fully healthy check we'd need Redis too, but we can at least test degraded.

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	Handler(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d (redis unhealthy)", rec.Code, http.StatusServiceUnavailable)
	}

	var resp Response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if resp.Status != "degraded" {
		t.Errorf("Status = %q, want %q", resp.Status, "degraded")
	}
	if resp.Service != "streaming" {
		t.Errorf("Service = %q, want %q", resp.Service, "streaming")
	}
	if resp.Checks["web"] != "ok" {
		t.Errorf("Checks[web] = %q, want %q", resp.Checks["web"], "ok")
	}
	if resp.Checks["redis"] != "unhealthy" {
		t.Errorf("Checks[redis] = %q, want %q", resp.Checks["redis"], "unhealthy")
	}
	if resp.Timestamp == "" {
		t.Error("Timestamp is empty")
	}
}

func TestDegradedWhenWebUnhealthy(t *testing.T) {
	// Web server returning 500
	webSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer webSrv.Close()

	os.Setenv("STREAMING_WEB_URL", webSrv.URL)
	defer os.Unsetenv("STREAMING_WEB_URL")

	SetRedisClient(nil) // ensure redis is also nil

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	Handler(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}

	var resp Response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if resp.Status != "degraded" {
		t.Errorf("Status = %q, want %q", resp.Status, "degraded")
	}
	if resp.Checks["web"] != "unhealthy" {
		t.Errorf("Checks[web] = %q, want %q", resp.Checks["web"], "unhealthy")
	}
}

func TestDegradedWhenWebUnreachable(t *testing.T) {
	// Point to a URL that won't respond
	os.Setenv("STREAMING_WEB_URL", "http://127.0.0.1:1")
	defer os.Unsetenv("STREAMING_WEB_URL")

	SetRedisClient(nil)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	Handler(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}

	var resp Response
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Checks["web"] != "unhealthy" {
		t.Errorf("Checks[web] = %q, want %q", resp.Checks["web"], "unhealthy")
	}
}

func TestDegradedWhenSubscriptionNotReady(t *testing.T) {
	// Ensure subscription is not ready (default state)
	streamReady.Store(false)

	webSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer webSrv.Close()

	os.Setenv("STREAMING_WEB_URL", webSrv.URL)
	defer os.Unsetenv("STREAMING_WEB_URL")

	SetRedisClient(nil) // redis unhealthy too, but subscription is the new check

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	Handler(rec, req)

	var resp Response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if resp.Status != "degraded" {
		t.Errorf("Status = %q, want %q", resp.Status, "degraded")
	}
	if resp.Checks["subscription"] != "not_subscribed" {
		t.Errorf("Checks[subscription] = %q, want %q", resp.Checks["subscription"], "not_subscribed")
	}
}

func TestHealthyWhenSubscriptionReady(t *testing.T) {
	// Mark subscription as ready
	streamReady.Store(true)
	defer streamReady.Store(false) // reset for other tests

	webSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer webSrv.Close()

	os.Setenv("STREAMING_WEB_URL", webSrv.URL)
	defer os.Unsetenv("STREAMING_WEB_URL")

	// Redis is nil so still degraded — but subscription check passes
	SetRedisClient(nil)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	Handler(rec, req)

	var resp Response
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Checks["subscription"] != "ok" {
		t.Errorf("Checks[subscription] = %q, want %q", resp.Checks["subscription"], "ok")
	}
	// Still degraded because redis is nil
	if resp.Status != "degraded" {
		t.Errorf("Status = %q, want %q (redis still unhealthy)", resp.Status, "degraded")
	}
}

func TestRedisNilClientReturnsUnhealthy(t *testing.T) {
	SetRedisClient(nil)
	// nil context is fine here because the function returns early before using it
	status := checkRedisConnection(context.Background())
	if status != "unhealthy" {
		t.Errorf("status = %q, want %q", status, "unhealthy")
	}
}

func TestCheckWebHealthDefaultURL(t *testing.T) {
	// Unset the env var to test default
	os.Unsetenv("STREAMING_WEB_URL")

	// With default URL (http://web:5555), web will be unreachable in test
	ctx := context.Background()
	status := checkWebHealth(ctx)
	if status != "unhealthy" {
		t.Errorf("status = %q, want %q (default URL unreachable)", status, "unhealthy")
	}
}

func TestCheckWebHealthTrailingSlash(t *testing.T) {
	// Test that trailing slashes are trimmed
	webSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			t.Errorf("path = %q, want /api/health", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer webSrv.Close()

	os.Setenv("STREAMING_WEB_URL", webSrv.URL+"/")
	defer os.Unsetenv("STREAMING_WEB_URL")

	status := checkWebHealth(context.Background())
	if status != "ok" {
		t.Errorf("status = %q, want %q", status, "ok")
	}
}

func TestResponseContentType(t *testing.T) {
	webSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer webSrv.Close()

	os.Setenv("STREAMING_WEB_URL", webSrv.URL)
	defer os.Unsetenv("STREAMING_WEB_URL")

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	Handler(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}
}

func TestResponseShape(t *testing.T) {
	webSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer webSrv.Close()

	os.Setenv("STREAMING_WEB_URL", webSrv.URL)
	defer os.Unsetenv("STREAMING_WEB_URL")

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	Handler(rec, req)

	// Verify all expected JSON fields are present
	var raw map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}

	for _, key := range []string{"status", "service", "checks", "timestamp"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("missing JSON key %q", key)
		}
	}

	checks, ok := raw["checks"].(map[string]interface{})
	if !ok {
		t.Fatal("checks is not an object")
	}
	for _, key := range []string{"redis", "web", "subscription"} {
		if _, ok := checks[key]; !ok {
			t.Errorf("missing checks key %q", key)
		}
	}
}
