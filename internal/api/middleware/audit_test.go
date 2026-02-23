package middleware

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/flexinfer/flexdeck/internal/audit"
	"github.com/flexinfer/flexdeck/internal/rbac"
)

func TestAuditLogger_Log(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := audit.NewStore(client, 1)
	al := NewAuditLogger(nil, store)

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		w.Write([]byte("ok"))
	})

	t.Run("Logs mutation with body", func(t *testing.T) {
		handler := al.Log("test-action")(next)
		
		body := bytes.NewReader([]byte(`{"foo":"bar"}`))
		req := httptest.NewRequest(http.MethodPost, "/api/mutate", body)
		req.Header.Set("Content-Type", "application/json")
		
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusAccepted {
			t.Errorf("expected 202, got %d", rr.Code)
		}

		// Wait for background record
		time.Sleep(100 * time.Millisecond)

		entries, _, _ := store.Query(context.Background(), audit.QueryOpts{})
		if len(entries) != 1 {
			t.Fatalf("expected 1 entry in store, got %d", len(entries))
		}

		if entries[0].Action != "test-action" || entries[0].Body != `{"foo":"bar"}` {
			t.Errorf("unexpected entry: %+v", entries[0])
		}
	})

	t.Run("Redacts sensitive fields", func(t *testing.T) {
		handler := al.Log("login")(next)
		
		body := bytes.NewReader([]byte(`{"username":"admin","password":"secret-password"}`))
		req := httptest.NewRequest(http.MethodPost, "/api/login", body)
		
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		time.Sleep(100 * time.Millisecond)

		entries, _, _ := store.Query(context.Background(), audit.QueryOpts{})
		// Find the 'login' entry
		var entry *audit.Entry
		for _, e := range entries {
			if e.Action == "login" {
				entry = &e
				break
			}
		}

		if entry == nil {
			t.Fatal("login entry not found")
		}

		if entry.Body != "[redacted: contains sensitive field]" {
			t.Errorf("expected redaction, got %q", entry.Body)
		}
	})

	t.Run("Attaches RBAC user", func(t *testing.T) {
		handler := al.Log("action-with-user")(next)
		
		req := httptest.NewRequest(http.MethodPost, "/api/action", nil)
		user := &rbac.User{ID: "user-123", Username: "alice", Role: rbac.RoleAdmin}
		ctx := rbac.ContextWithUser(req.Context(), user)
		req = req.WithContext(ctx)
		
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		time.Sleep(100 * time.Millisecond)

		entries, _, _ := store.Query(context.Background(), audit.QueryOpts{})
		var entry *audit.Entry
		for _, e := range entries {
			if e.Action == "action-with-user" {
				entry = &e
				break
			}
		}

		if entry == nil {
			t.Fatal("entry not found")
		}

		if entry.UserID != "user-123" || entry.Username != "alice" {
			t.Errorf("unexpected user info in entry: %+v", entry)
		}
	})
}
