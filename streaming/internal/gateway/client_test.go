package gateway

import (
	"context"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestNewClientStoresRedisClient(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	client := NewClient(rdb)
	if client == nil {
		t.Fatal("NewClient returned nil")
	}
	if client.rdb != rdb {
		t.Error("client.rdb does not match provided redis client")
	}
}

func TestNewClientPubsubStartsNil(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	client := NewClient(rdb)
	if client.pubsub != nil {
		t.Error("expected pubsub to be nil before subscription")
	}
}

func TestCloseWithoutSubscription(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	client := NewClient(rdb)

	// Close without ever subscribing should not panic or error
	err := client.Close()
	if err != nil {
		t.Errorf("Close() error = %v, want nil", err)
	}
}

func TestCloseIdempotent(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	client := NewClient(rdb)

	// Multiple closes should not panic
	_ = client.Close()
	err := client.Close()
	if err != nil {
		t.Errorf("second Close() error = %v, want nil", err)
	}
}

func TestPublishTokenReturnsErrorWhenRedisDown(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{
		Addr:        "127.0.0.1:1", // unreachable
		DialTimeout: 100 * time.Millisecond,
	})
	defer rdb.Close()

	client := NewClient(rdb)

	ctx := context.Background()
	err := client.PublishToken(ctx, "ch-1", "msg-1", `{"token":"hello"}`)
	if err == nil {
		t.Error("expected error for unreachable Redis")
	}
}

func TestPublishStatusReturnsErrorWhenRedisDown(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{
		Addr:        "127.0.0.1:1",
		DialTimeout: 100 * time.Millisecond,
	})
	defer rdb.Close()

	client := NewClient(rdb)

	ctx := context.Background()
	err := client.PublishStatus(ctx, "ch-1", "msg-1", `{"status":"COMPLETE"}`)
	if err == nil {
		t.Error("expected error for unreachable Redis")
	}
}

func TestPublishThinkingReturnsErrorWhenRedisDown(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{
		Addr:        "127.0.0.1:1",
		DialTimeout: 100 * time.Millisecond,
	})
	defer rdb.Close()

	client := NewClient(rdb)

	ctx := context.Background()
	err := client.PublishThinking(ctx, "ch-1", "msg-1", `{"phase":"thinking"}`)
	if err == nil {
		t.Error("expected error for unreachable Redis")
	}
}
