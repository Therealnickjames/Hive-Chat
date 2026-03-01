// Package gateway provides the Redis pub/sub client for communicating
// with the Elixir Gateway.
//
// The streaming proxy uses Redis to:
// - Subscribe to stream requests (hive:stream:request)
// - Publish tokens (hive:stream:tokens:{channelId}:{messageId})
// - Publish stream status (hive:stream:status:{channelId}:{messageId})
//
// See docs/PROTOCOL.md §2 for Redis event contracts.
package gateway

import (
	"context"

	"github.com/redis/go-redis/v9"
)

// Client wraps Redis pub/sub for Gateway communication.
type Client struct {
	rdb    *redis.Client
	pubsub *redis.PubSub // stored for cleanup on shutdown (ISSUE-009)
}

// NewClient creates a new Gateway client.
func NewClient(rdb *redis.Client) *Client {
	return &Client{rdb: rdb}
}

// SubscribeStreamRequests subscribes to the stream request channel.
// Returns a channel of raw JSON messages.
// The subscription is stored on the Client and closed by Close().
func (c *Client) SubscribeStreamRequests(ctx context.Context) (<-chan string, error) {
	c.pubsub = c.rdb.Subscribe(ctx, "hive:stream:request")

	// Verify subscription
	_, err := c.pubsub.Receive(ctx)
	if err != nil {
		return nil, err
	}

	ch := make(chan string, 100)
	go func() {
		defer close(ch)
		for msg := range c.pubsub.Channel() {
			ch <- msg.Payload
		}
	}()

	return ch, nil
}

// Close cleans up the Redis pub/sub subscription.
// Must be called during shutdown to allow graceful exit. (ISSUE-009)
func (c *Client) Close() error {
	if c.pubsub != nil {
		return c.pubsub.Close()
	}
	return nil
}

// PublishToken publishes a streaming token to Redis.
func (c *Client) PublishToken(ctx context.Context, channelID, messageID, payload string) error {
	topic := "hive:stream:tokens:" + channelID + ":" + messageID
	return c.rdb.Publish(ctx, topic, payload).Err()
}

// PublishStatus publishes a stream completion/error status to Redis.
func (c *Client) PublishStatus(ctx context.Context, channelID, messageID, payload string) error {
	topic := "hive:stream:status:" + channelID + ":" + messageID
	return c.rdb.Publish(ctx, topic, payload).Err()
}
