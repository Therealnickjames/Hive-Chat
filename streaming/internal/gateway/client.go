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
	rdb          *redis.Client
	pubsub       *redis.PubSub // stored for cleanup on shutdown (ISSUE-009)
	resumePubsub *redis.PubSub // TASK-0021: resume subscription
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

// SubscribeStreamResume subscribes to the stream resume channel. (TASK-0021)
// Returns a channel of raw JSON messages for resume requests.
func (c *Client) SubscribeStreamResume(ctx context.Context) (<-chan string, error) {
	c.resumePubsub = c.rdb.Subscribe(ctx, "hive:stream:resume")

	_, err := c.resumePubsub.Receive(ctx)
	if err != nil {
		return nil, err
	}

	ch := make(chan string, 100)
	go func() {
		defer close(ch)
		for msg := range c.resumePubsub.Channel() {
			ch <- msg.Payload
		}
	}()

	return ch, nil
}

// Close cleans up the Redis pub/sub subscriptions.
// Must be called during shutdown to allow graceful exit. (ISSUE-009)
func (c *Client) Close() error {
	if c.resumePubsub != nil {
		_ = c.resumePubsub.Close()
	}
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

// PublishThinking publishes a thinking phase change to Redis.
// The Gateway subscribes to this pattern and broadcasts to WebSocket clients.
// See docs/PROTOCOL.md — StreamThinkingPayload.
func (c *Client) PublishThinking(ctx context.Context, channelID, messageID, payload string) error {
	topic := "hive:stream:thinking:" + channelID + ":" + messageID
	return c.rdb.Publish(ctx, topic, payload).Err()
}

// PublishToolCall publishes a tool call event to Redis. (TASK-0018)
// The Gateway subscribes to this pattern and broadcasts to WebSocket clients.
// Sent when the LLM requests a tool execution.
func (c *Client) PublishToolCall(ctx context.Context, channelID, messageID, payload string) error {
	topic := "hive:stream:tool_call:" + channelID + ":" + messageID
	return c.rdb.Publish(ctx, topic, payload).Err()
}

// PublishToolResult publishes a tool result event to Redis. (TASK-0018)
// The Gateway subscribes to this pattern and broadcasts to WebSocket clients.
// Sent after tool execution completes.
func (c *Client) PublishToolResult(ctx context.Context, channelID, messageID, payload string) error {
	topic := "hive:stream:tool_result:" + channelID + ":" + messageID
	return c.rdb.Publish(ctx, topic, payload).Err()
}

// PublishCheckpoint publishes a stream checkpoint event to Redis. (TASK-0021)
// The Gateway subscribes to hive:stream:checkpoint:* pattern and broadcasts
// as stream_checkpoint events to room:{channelId} for rewind UI.
func (c *Client) PublishCheckpoint(ctx context.Context, channelID, messageID, payload string) error {
	topic := "hive:stream:checkpoint:" + channelID + ":" + messageID
	return c.rdb.Publish(ctx, topic, payload).Err()
}

// PublishCharterStatus publishes a charter status update to Redis. (TASK-0020)
// The Gateway subscribes to hive:stream:charter_status:* pattern and broadcasts
// as charter_status events to room:{channelId} for live header updates.
func (c *Client) PublishCharterStatus(ctx context.Context, channelID, payload string) error {
	topic := "hive:stream:charter_status:" + channelID
	return c.rdb.Publish(ctx, topic, payload).Err()
}
