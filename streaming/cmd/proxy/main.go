// Tavok Streaming Proxy — Go service for LLM API streaming
//
// This service:
// - Listens for stream requests on Redis pub/sub
// - Opens SSE connections to LLM APIs (Anthropic, OpenAI, etc.)
// - Pushes tokens back through Redis to the Elixir Gateway
// - Handles agent configuration loading from the Next.js API
//
// See docs/PROTOCOL.md §2 for Redis pub/sub contracts.
// See docs/DECISIONS.md DEC-0001 for architecture rationale.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/TavokAI/Tavok/streaming/internal/config"
	"github.com/TavokAI/Tavok/streaming/internal/gateway"
	"github.com/TavokAI/Tavok/streaming/internal/health"
	"github.com/TavokAI/Tavok/streaming/internal/provider"
	"github.com/TavokAI/Tavok/streaming/internal/stream"
	"github.com/TavokAI/Tavok/streaming/internal/tools"
	"github.com/redis/go-redis/v9"
)

func main() {
	// Structured JSON logging from day 1
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Configuration from environment
	port := getEnv("STREAMING_PORT", "4002")
	redisURL := getEnv("STREAMING_REDIS_URL", getEnv("REDIS_URL", "redis://localhost:6379"))
	webURL := getEnv("STREAMING_WEB_URL", getEnv("WEB_INTERNAL_URL", "http://web:5555"))
	internalSecret := os.Getenv("INTERNAL_API_SECRET")
	if internalSecret == "" {
		slog.Error("INTERNAL_API_SECRET must be set")
		os.Exit(1)
	}

	// Connect to Redis
	redisOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Error("Failed to parse Redis URL", "error", err, "url", redisURL)
		os.Exit(1)
	}

	rdb := redis.NewClient(redisOpts)
	health.SetRedisClient(rdb)

	// Verify Redis connection
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Error("Failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	slog.Info("Connected to Redis", "url", redisURL)

	// Create gateway client (Redis pub/sub for communication with Elixir Gateway)
	gwClient := gateway.NewClient(rdb)

	// Create config loader (HTTP client for Next.js internal API)
	loader := config.NewLoader(webURL, internalSecret)

	// Create provider registry
	registry := provider.NewRegistry()

	// Create tool registry (TASK-0018)
	toolRegistry := tools.NewRegistry()
	toolRegistry.Register(tools.NewCurrentTime())
	toolRegistry.Register(tools.NewWebSearch(tools.WebSearchConfig{
		APIEndpoint: os.Getenv("STREAMING_SEARCH_API_URL"),
		APIKey:      os.Getenv("STREAMING_SEARCH_API_KEY"),
	}))
	slog.Info("Tool registry initialized", "toolCount", toolRegistry.Count())

	// Create stream manager
	maxConcurrentStreams := getEnvInt("STREAMING_MAX_CONCURRENT_STREAMS", 32)
	manager := stream.NewManager(logger, gwClient, loader, registry, toolRegistry, maxConcurrentStreams)

	// Start stream manager in background
	managerCtx, managerCancel := context.WithCancel(ctx)
	go func() {
		if err := manager.Start(managerCtx); err != nil && err != context.Canceled {
			slog.Error("Stream manager error", "error", err)
		}
	}()

	// HTTP server for health checks
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health.Handler)

	// Debug endpoint: show service info
	mux.HandleFunc("GET /info", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"service":       "streaming",
			"version":       "0.1.0",
			"redis":         "connected",
			"activeStreams": manager.ActiveCount(),
		})
	})

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		slog.Info("Streaming proxy starting", "port", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("Server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit

	slog.Info("Shutting down", "signal", sig.String())

	// Stop stream manager first (cancel context drains active streams)
	managerCancel()

	// Drain timeout: 30 seconds
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("Server forced shutdown", "error", err)
	}

	// Close gateway client pub/sub subscription (ISSUE-009)
	if err := gwClient.Close(); err != nil {
		slog.Error("Gateway client close error", "error", err)
	}

	// Close Redis connection
	if err := rdb.Close(); err != nil {
		slog.Error("Redis close error", "error", err)
	}

	slog.Info("Streaming proxy stopped")
}

// getEnv reads an environment variable with a fallback default
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}

	decodeValue, err := strconv.Atoi(value)
	if err != nil {
		return defaultValue
	}

	return decodeValue
}
