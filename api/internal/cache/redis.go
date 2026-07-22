package cache

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// DefaultTTL is the default cache duration for GET responses.
const DefaultTTL = 5 * time.Minute

// Cache wraps a Redis client with convenience methods for caching.
type Cache struct {
	client *redis.Client
}

// New creates a Cache from a Redis connection URL (e.g. "redis://localhost:6379/0").
func New(ctx context.Context, redisURL string) (*Cache, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}

	client := redis.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	return &Cache{client: client}, nil
}

// Get returns the cached value for key, or "" if not found.
func (c *Cache) Get(ctx context.Context, key string) (string, error) {
	val, err := c.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", nil
	}
	return val, err
}

// Set stores a value in cache with the given TTL.
func (c *Cache) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	return c.client.Set(ctx, key, value, ttl).Err()
}

// Incr atomically increments the integer at key and returns the new value.
// Missing keys start at 0.
func (c *Cache) Incr(ctx context.Context, key string) (int64, error) {
	return c.client.Incr(ctx, key).Result()
}

// DecrBy atomically subtracts n from the integer at key. Used to drain a counter
// without losing increments that landed while it was being read.
func (c *Cache) DecrBy(ctx context.Context, key string, n int64) error {
	return c.client.DecrBy(ctx, key, n).Err()
}

// Invalidate deletes all keys matching the given pattern (e.g. "states:*").
// Uses a pipeline for efficient batch deletion.
func (c *Cache) Invalidate(ctx context.Context, pattern string) error {
	var keys []string
	iter := c.client.Scan(ctx, 0, pattern, 100).Iterator()
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	if err := iter.Err(); err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}

	pipe := c.client.Pipeline()
	for _, key := range keys {
		pipe.Del(ctx, key)
	}
	_, err := pipe.Exec(ctx)
	return err
}

// Ping checks that Redis is reachable.
func (c *Cache) Ping(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

// Close shuts down the Redis client.
func (c *Cache) Close() error {
	return c.client.Close()
}
