// Package health provides the health check endpoint for the streaming proxy.
package health

import (
	"encoding/json"
	"net/http"
	"time"
)

// Response is the health check response shape.
// Matches docs/PROTOCOL.md HealthResponse type.
type Response struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Timestamp string `json:"timestamp"`
}

// Handler responds to GET /health with service status.
func Handler(w http.ResponseWriter, r *http.Request) {
	resp := Response{
		Status:    "ok",
		Service:   "streaming",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}
