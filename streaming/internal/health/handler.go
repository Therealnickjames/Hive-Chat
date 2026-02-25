// Package health provides the health check endpoint for the streaming proxy.
package health

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Response is the health check response shape.
// Matches docs/PROTOCOL.md HealthResponse type.
type Response struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Checks    map[string]string `json:"checks"`
	Timestamp string `json:"timestamp"`
}

// Handler responds to GET /health with service status.
func Handler(w http.ResponseWriter, r *http.Request) {
	isHealthy := true
	redisStatus := checkRedisConnection(r.Context())
	webStatus := checkWebHealth(r.Context())

	if redisStatus != "ok" || webStatus != "ok" {
		isHealthy = false
	}

	resp := Response{
		Status:  "ok",
		Service: "streaming",
		Checks: map[string]string{
			"redis": redisStatus,
			"web":   webStatus,
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	if !isHealthy {
		resp.Status = "degraded"
	}

	w.Header().Set("Content-Type", "application/json")
	if !isHealthy {
		w.WriteHeader(http.StatusServiceUnavailable)
	} else {
		w.WriteHeader(http.StatusOK)
	}
	json.NewEncoder(w).Encode(resp)
}

var redisClient *redis.Client

func SetRedisClient(client *redis.Client) {
	redisClient = client
}

func checkRedisConnection(ctx context.Context) string {
	client := redisClient
	if client == nil {
		return "unhealthy"
	}

	redisCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if err := client.Ping(redisCtx).Err(); err != nil {
		return "unhealthy"
	}

	return "ok"
}

func checkWebHealth(ctx context.Context) string {
	baseURL := os.Getenv("STREAMING_WEB_URL")
	if baseURL == "" {
		baseURL = "http://web:3000"
	}
	url := strings.TrimRight(baseURL, "/") + "/api/health"
	reqCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return "unhealthy"
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		return "unhealthy"
	}

	if err := resp.Body.Close(); err != nil {
		return "unhealthy"
	}

	return "ok"
}
