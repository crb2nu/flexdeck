package rbac

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/google/uuid"
)

// Registry manages RBAC users with JSON file persistence.
type Registry struct {
	mu       sync.RWMutex
	users    map[string]*User
	byHash   map[string]*User // tokenHash -> user (lookup index)
	filePath string
}

// NewRegistry creates a new RBAC registry, loading from file and optionally
// bootstrapping an admin user when the registry is empty and AdminToken is set.
func NewRegistry(cfg config.RBACConfig) (*Registry, error) {
	r := &Registry{
		users:    make(map[string]*User),
		byHash:   make(map[string]*User),
		filePath: cfg.UsersPath,
	}

	if err := r.load(); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to load RBAC registry: %w", err)
	}

	// Bootstrap admin user on first run
	if len(r.users) == 0 && cfg.AdminToken != "" {
		now := time.Now()
		admin := &User{
			ID:        uuid.New().String(),
			Username:  "admin",
			Role:      RoleAdmin,
			TokenHash: hashToken(cfg.AdminToken),
			CreatedAt: now,
			UpdatedAt: now,
		}
		r.users[admin.ID] = admin
		r.byHash[admin.TokenHash] = admin
		if err := r.save(); err != nil {
			slog.Warn("rbac: failed to persist bootstrapped admin", "error", err)
		}
		slog.Info("rbac: bootstrapped admin user", "id", admin.ID)
	}

	return r, nil
}

// List returns all users with token hashes redacted.
func (r *Registry) List() []*User {
	r.mu.RLock()
	defer r.mu.RUnlock()

	users := make([]*User, 0, len(r.users))
	for _, u := range r.users {
		cp := *u
		cp.TokenHash = ""
		users = append(users, &cp)
	}
	return users
}

// Get returns a user by ID (token hash redacted).
func (r *Registry) Get(id string) (*User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	u, ok := r.users[id]
	if !ok {
		return nil, fmt.Errorf("user not found: %s", id)
	}
	cp := *u
	cp.TokenHash = ""
	return &cp, nil
}

// Create adds a new user. Returns the plaintext token (shown only once).
func (r *Registry) Create(username string, role Role) (*User, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Check unique username
	for _, u := range r.users {
		if u.Username == username {
			return nil, "", fmt.Errorf("username already exists: %s", username)
		}
	}

	token, err := generateToken()
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate token: %w", err)
	}

	now := time.Now()
	user := &User{
		ID:        uuid.New().String(),
		Username:  username,
		Role:      role,
		TokenHash: hashToken(token),
		CreatedAt: now,
		UpdatedAt: now,
	}

	r.users[user.ID] = user
	r.byHash[user.TokenHash] = user
	if err := r.save(); err != nil {
		return nil, "", fmt.Errorf("failed to persist user: %w", err)
	}

	return user, token, nil
}

// Update modifies an existing user's role or disabled status.
func (r *Registry) Update(id string, role *Role, disabled *bool) (*User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	u, ok := r.users[id]
	if !ok {
		return nil, fmt.Errorf("user not found: %s", id)
	}

	if role != nil {
		u.Role = *role
	}
	if disabled != nil {
		u.Disabled = *disabled
	}
	u.UpdatedAt = time.Now()

	if err := r.save(); err != nil {
		return nil, fmt.Errorf("failed to persist update: %w", err)
	}

	cp := *u
	cp.TokenHash = ""
	return &cp, nil
}

// Delete removes a user by ID.
func (r *Registry) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	u, ok := r.users[id]
	if !ok {
		return fmt.Errorf("user not found: %s", id)
	}

	delete(r.byHash, u.TokenHash)
	delete(r.users, id)
	return r.save()
}

// Authenticate looks up a user by bearer token.
func (r *Registry) Authenticate(token string) (*User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	h := hashToken(token)
	u, ok := r.byHash[h]
	if !ok {
		return nil, fmt.Errorf("invalid token")
	}
	if u.Disabled {
		return nil, fmt.Errorf("user disabled")
	}

	now := time.Now()
	u.LastLogin = &now
	// best-effort persist
	_ = r.save()

	return u, nil
}

// HasPermission checks whether a user's role grants the given permission.
func HasPermission(user *User, perm Permission) bool {
	if user == nil {
		return false
	}
	perms, ok := RolePermissions[user.Role]
	if !ok {
		return false
	}
	for _, p := range perms {
		if p == perm {
			return true
		}
	}
	return false
}

// --- persistence ---

func (r *Registry) load() error {
	data, err := os.ReadFile(r.filePath)
	if err != nil {
		return err
	}

	var users []*User
	if err := json.Unmarshal(data, &users); err != nil {
		return fmt.Errorf("failed to parse RBAC registry: %w", err)
	}

	r.users = make(map[string]*User, len(users))
	r.byHash = make(map[string]*User, len(users))
	for _, u := range users {
		r.users[u.ID] = u
		if u.TokenHash != "" {
			r.byHash[u.TokenHash] = u
		}
	}
	return nil
}

func (r *Registry) save() error {
	users := make([]*User, 0, len(r.users))
	for _, u := range r.users {
		users = append(users, u)
	}

	data, err := json.MarshalIndent(users, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal RBAC registry: %w", err)
	}

	dir := filepath.Dir(r.filePath)
	if dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0755)
	}
	return os.WriteFile(r.filePath, data, 0644)
}

// --- helpers ---

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}
