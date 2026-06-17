package rbac

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/flexinfer/flexdeck/internal/config"
)

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("start miniredis: %v", err)
	}
	t.Cleanup(server.Close)

	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return client
}

// TestRedisRegistryBootstrapsAdmin verifies the Redis-backed registry
// bootstraps an admin user from AdminToken when the store is empty.
func TestRedisRegistryBootstrapsAdmin(t *testing.T) {
	client := newTestRedis(t)

	r, err := NewRedisRegistry(config.RBACConfig{AdminToken: "admin-secret"}, client)
	if err != nil {
		t.Fatalf("NewRedisRegistry: %v", err)
	}

	user, err := r.Authenticate("admin-secret")
	if err != nil {
		t.Fatalf("authenticate admin: %v", err)
	}
	if user.Role != RoleAdmin {
		t.Fatalf("bootstrapped user role = %q, want %q", user.Role, RoleAdmin)
	}
}

// TestRedisRegistryPersistsAcrossRestart verifies that users created through a
// Redis-backed registry survive a process "restart" (a fresh Registry built
// against the same Redis), which is the durability property an emptyDir-backed
// file store cannot provide.
func TestRedisRegistryPersistsAcrossRestart(t *testing.T) {
	client := newTestRedis(t)

	cfg := config.RBACConfig{AdminToken: "admin-secret"}

	r1, err := NewRedisRegistry(cfg, client)
	if err != nil {
		t.Fatalf("NewRedisRegistry (first): %v", err)
	}

	created, token, err := r1.Create("editor-1", RoleEditor)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	// Simulate a pod restart: a brand-new registry loading from the same Redis.
	r2, err := NewRedisRegistry(cfg, client)
	if err != nil {
		t.Fatalf("NewRedisRegistry (second): %v", err)
	}

	got, err := r2.Get(created.ID)
	if err != nil {
		t.Fatalf("get persisted user after restart: %v", err)
	}
	if got.Username != "editor-1" || got.Role != RoleEditor {
		t.Fatalf("persisted user = %+v, want editor-1/editor", got)
	}

	// The created user's token must still authenticate after the restart.
	authed, err := r2.Authenticate(token)
	if err != nil {
		t.Fatalf("authenticate persisted user after restart: %v", err)
	}
	if authed.ID != created.ID {
		t.Fatalf("authenticated user ID = %q, want %q", authed.ID, created.ID)
	}

	// Bootstrap must not duplicate the admin on reload: admin + editor only.
	if n := len(r2.List()); n != 2 {
		t.Fatalf("user count after restart = %d, want 2", n)
	}
}

// TestRedisStoreLoadEmptyReturnsNil verifies an absent key is treated as an
// empty set (not an error), so first-run bootstrap proceeds.
func TestRedisStoreLoadEmptyReturnsNil(t *testing.T) {
	client := newTestRedis(t)

	store := redisStore{client: client, key: redisUsersKey}
	users, err := store.Load()
	if err != nil {
		t.Fatalf("load empty store: %v", err)
	}
	if users != nil {
		t.Fatalf("load empty store = %v, want nil", users)
	}
}
