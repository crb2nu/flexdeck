package rbac

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/redis/go-redis/v9"
)

// redisUsersKey is the Redis key under which the RBAC user set is persisted.
const redisUsersKey = "flexdeck:rbac:users"

// redisOpTimeout bounds each Redis persistence operation so a slow or
// unreachable Redis cannot block request handling indefinitely.
const redisOpTimeout = 5 * time.Second

// userStore abstracts persistence of the RBAC user set. Implementations must
// treat an absent store (no file / missing key) as an empty set by returning
// (nil, nil) from Load rather than an error, so first-run bootstrap works.
type userStore interface {
	Load() ([]*User, error)
	Save(users []*User) error
}

// fileStore persists the user set as indented JSON on local disk. It is the
// default backend and preserves the original file-based behavior.
type fileStore struct {
	path string
}

func (s fileStore) Load() ([]*User, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var users []*User
	if err := json.Unmarshal(data, &users); err != nil {
		return nil, fmt.Errorf("failed to parse RBAC registry: %w", err)
	}
	return users, nil
}

func (s fileStore) Save(users []*User) error {
	data, err := json.MarshalIndent(users, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal RBAC registry: %w", err)
	}

	dir := filepath.Dir(s.path)
	if dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0755)
	}
	return os.WriteFile(s.path, data, 0644)
}

// redisStore persists the user set as a single JSON blob under a Redis key.
// Durability is delegated to the Redis deployment (e.g. AOF + a PVC), which
// keeps the flexdeck server pod free of any external-storage startup
// dependency.
type redisStore struct {
	client *redis.Client
	key    string
}

func (s redisStore) Load() ([]*User, error) {
	ctx, cancel := context.WithTimeout(context.Background(), redisOpTimeout)
	defer cancel()

	data, err := s.client.Get(ctx, s.key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}

	var users []*User
	if err := json.Unmarshal(data, &users); err != nil {
		return nil, fmt.Errorf("failed to parse RBAC registry: %w", err)
	}
	return users, nil
}

func (s redisStore) Save(users []*User) error {
	data, err := json.Marshal(users)
	if err != nil {
		return fmt.Errorf("failed to marshal RBAC registry: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), redisOpTimeout)
	defer cancel()

	// No TTL: the RBAC user set must persist indefinitely.
	return s.client.Set(ctx, s.key, data, 0).Err()
}
