package rbac

import (
	"path/filepath"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestRegistry(t *testing.T) {
	tempDir := t.TempDir()

	usersPath := filepath.Join(tempDir, "users.json")
	cfg := config.RBACConfig{
		UsersPath:  usersPath,
		AdminToken: "admin-secret",
	}

	r, err := NewRegistry(cfg)
	if err != nil {
		t.Fatalf("failed to create registry: %v", err)
	}

	// Test Bootstrap
	users := r.List()
	if len(users) != 1 || users[0].Username != "admin" {
		t.Errorf("expected bootstrapped admin user")
	}

	// Test Authenticate
	u, err := r.Authenticate("admin-secret")
	if err != nil {
		t.Fatalf("auth failed: %v", err)
	}
	if u.Username != "admin" {
		t.Errorf("expected admin user, got %s", u.Username)
	}

	// Test Create
	u2, token, err := r.Create("bob", RoleEditor)
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}
	if token == "" {
		t.Errorf("expected token to be returned")
	}

	// Test Authenticate bob
	u2Auth, err := r.Authenticate(token)
	if err != nil {
		t.Fatalf("auth bob failed: %v", err)
	}
	if u2Auth.ID != u2.ID {
		t.Errorf("auth returned wrong user")
	}

	// Test HasPermission
	if !HasPermission(u, PermAdmin) {
		t.Errorf("admin should have admin permission")
	}
	if !HasPermission(u2, PermWrite) {
		t.Errorf("editor should have write permission")
	}
	if HasPermission(u2, PermAdmin) {
		t.Errorf("editor should not have admin permission")
	}

	// Test Update
	disabled := true
	_, err = r.Update(u2.ID, nil, &disabled)
	if err != nil {
		t.Fatalf("update failed: %v", err)
	}

	_, err = r.Authenticate(token)
	if err == nil {
		t.Errorf("expected error authenticating disabled user")
	}

	// Test Delete
	err = r.Delete(u2.ID)
	if err != nil {
		t.Fatalf("delete failed: %v", err)
	}
	if len(r.List()) != 1 {
		t.Errorf("expected 1 user after delete")
	}
}
