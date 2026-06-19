package qdrant

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScroll_FilterAndPayload(t *testing.T) {
	var gotBody map[string]any
	var gotAPIKey string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAPIKey = r.Header.Get("api-key")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":{"points":[{"id":"p1","payload":{"project":"services/flexdeck","title":"x"}}],"next_page_offset":null},"status":"ok"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/", WithAPIKey("secret"))
	pts, err := c.Scroll(context.Background(), "agent_tasks_v1", MatchProject("services/flexdeck"), 50)
	if err != nil {
		t.Fatalf("scroll: %v", err)
	}
	if len(pts) != 1 || pts[0].Payload["title"] != "x" {
		t.Fatalf("points = %+v", pts)
	}
	if gotAPIKey != "secret" {
		t.Errorf("api-key header = %q, want secret", gotAPIKey)
	}
	if gotBody["with_vector"] != false || gotBody["with_payload"] != true {
		t.Errorf("body flags = %+v", gotBody)
	}
	if gotBody["filter"] == nil {
		t.Errorf("filter not sent")
	}
}

func TestScroll_NonOKReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"status":{"error":"Not found"}}`))
	}))
	defer ts.Close()

	c := New(ts.URL)
	if _, err := c.Scroll(context.Background(), "missing", nil, 10); err == nil {
		t.Fatalf("expected error for 404 collection")
	}
}

func TestScroll_Unconfigured(t *testing.T) {
	c := New("")
	if _, err := c.Scroll(context.Background(), "c", nil, 10); err == nil {
		t.Fatalf("expected error for empty base url")
	}
}

func TestScroll_Unreachable(t *testing.T) {
	c := New("http://127.0.0.1:0")
	if _, err := c.Scroll(context.Background(), "c", nil, 10); err == nil {
		t.Fatalf("expected error for unreachable server")
	}
}
