package apiutil

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRespondJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	data := map[string]string{"foo": "bar"}
	RespondJSON(rr, http.StatusCreated, data)

	if rr.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d", rr.Code)
	}

	contentType := rr.Header().Get("Content-Type")
	if contentType != "application/json; charset=utf-8" {
		t.Errorf("expected content type application/json; charset=utf-8, got %q", contentType)
	}

	var resp map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if resp["foo"] != "bar" {
		t.Errorf("expected data %v, got %v", data, resp)
	}
}

func TestRespondError(t *testing.T) {
	rr := httptest.NewRecorder()
	RespondError(rr, http.StatusBadRequest, "BAD_REQ", "something went wrong")

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", rr.Code)
	}

	var resp Response
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if resp.Error == nil {
		t.Fatal("expected error object, got nil")
	}

	if resp.Error.Code != "BAD_REQ" || resp.Error.Message != "something went wrong" {
		t.Errorf("unexpected error fields: %+v", resp.Error)
	}
}

func TestRespondData(t *testing.T) {
	rr := httptest.NewRecorder()
	data := []string{"a", "b"}
	RespondData(rr, data)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}

	var resp Response
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if resp.Data == nil {
		t.Fatal("expected data object, got nil")
	}

	// Unmarshal Data back to []string
	b, _ := json.Marshal(resp.Data)
	var finalData []string
	json.Unmarshal(b, &finalData)

	if len(finalData) != 2 || finalData[0] != "a" || finalData[1] != "b" {
		t.Errorf("unexpected data: %v", finalData)
	}
}

func TestURLBuilder(t *testing.T) {
	b := NewURLBuilder("http://example.com/")
	b.Path("api", "v1").
		RawPath("/models").
		Param("q", "llama").
		Param("empty", "").
		ParamInt("limit", 10).
		ParamInt("zero", 0).
		Params(map[string]string{"foo": "bar"})

	got := b.String()
	want := "http://example.com/api/v1/models?foo=bar&limit=10&q=llama"

	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestEscapeLabelValue(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"normal", "normal"},
		{`back\slash`, `back\\slash`},
		{`quote"`, `quote\"`},
		{"new\nline", `new\nline`},
	}

	for _, tt := range tests {
		if got := EscapeLabelValue(tt.in); got != tt.want {
			t.Errorf("EscapeLabelValue(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestSSEWriter(t *testing.T) {
	rr := httptest.NewRecorder()

	// Test failure when Flusher is not supported
	// httptest.ResponseRecorder supports Flusher, so we can't easily test failure here
	// unless we use a custom ResponseWriter that doesn't implement Flusher.

	sw, err := NewSSEWriter(rr)
	if err != nil {
		t.Fatalf("NewSSEWriter failed: %v", err)
	}

	if rr.Header().Get("Content-Type") != "text/event-stream" {
		t.Errorf("expected content type text/event-stream")
	}

	sw.SendReady()
	sw.SendData(map[string]string{"msg": "hello"})
	sw.SendEvent("custom", "val")
	sw.SendRaw("raw-data")
	sw.SendError("oops")
	sw.Flush()

	got := rr.Body.String()
	if !strings.Contains(got, "event: ready") {
		t.Errorf("missing ready event")
	}
	if !strings.Contains(got, `data: {"msg":"hello"}`) {
		t.Errorf("missing data message")
	}
	if !strings.Contains(got, "event: custom") {
		t.Errorf("missing custom event")
	}
	if !strings.Contains(got, "data: raw-data") {
		t.Errorf("missing raw data")
	}
	if !strings.Contains(got, "event: error") {
		t.Errorf("missing error event")
	}
}

type noFlushWriter struct {
	http.ResponseWriter
}

func TestNewSSEWriter_NoFlush(t *testing.T) {
	rr := httptest.NewRecorder()
	nw := &noFlushWriter{rr}
	_, err := NewSSEWriter(nw)
	if err == nil {
		t.Errorf("expected error for non-flushing ResponseWriter")
	}
}

func TestProxyRequest(t *testing.T) {
	// Mock target server
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"mock":"ok"}`))
	}))
	defer ts.Close()

	rr := httptest.NewRecorder()
	ProxyRequest(rr, ts.URL)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}

	if rr.Body.String() != `{"mock":"ok"}` {
		t.Errorf("expected body %q, got %q", `{"mock":"ok"}`, rr.Body.String())
	}
}

func TestProxyRequest_Error(t *testing.T) {
	rr := httptest.NewRecorder()
	ProxyRequest(rr, "http://invalid-url-that-does-not-exist")

	if rr.Code != http.StatusBadGateway {
		t.Errorf("expected status 502, got %d", rr.Code)
	}
}

func TestGuards(t *testing.T) {
	dummyHandler := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}

	t.Run("WithK8sGuard", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)

		// Case: disabled
		rr1 := httptest.NewRecorder()
		WithK8sGuard(nil, dummyHandler)(rr1, req)
		if rr1.Code != http.StatusServiceUnavailable {
			t.Errorf("expected 503, got %d", rr1.Code)
		}

		// Case: enabled
		rr2 := httptest.NewRecorder()
		WithK8sGuard("not-nil", dummyHandler)(rr2, req)
		if rr2.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr2.Code)
		}
	})

	t.Run("WithFeatureGuard", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)

		rr1 := httptest.NewRecorder()
		WithFeatureGuard(true, "MyFeature", dummyHandler)(rr1, req)
		if rr1.Code != http.StatusServiceUnavailable {
			t.Errorf("expected 503, got %d", rr1.Code)
		}

		rr2 := httptest.NewRecorder()
		WithFeatureGuard(false, "MyFeature", dummyHandler)(rr2, req)
		if rr2.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr2.Code)
		}
	})

	t.Run("WithURLGuard", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)

		rr1 := httptest.NewRecorder()
		WithURLGuard("", "MyService", dummyHandler)(rr1, req)
		if rr1.Code != http.StatusServiceUnavailable {
			t.Errorf("expected 503, got %d", rr1.Code)
		}

		rr2 := httptest.NewRecorder()
		WithURLGuard("http://service", "MyService", dummyHandler)(rr2, req)
		if rr2.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr2.Code)
		}
	})

	t.Run("WithConfigGuard", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)

		// Case: disabled
		rr1 := httptest.NewRecorder()
		WithConfigGuard(true, "http://service", "MyService", dummyHandler)(rr1, req)
		if rr1.Code != http.StatusServiceUnavailable {
			t.Errorf("expected 503, got %d", rr1.Code)
		}

		// Case: unconfigured
		rr2 := httptest.NewRecorder()
		WithConfigGuard(false, "", "MyService", dummyHandler)(rr2, req)
		if rr2.Code != http.StatusServiceUnavailable {
			t.Errorf("expected 503, got %d", rr2.Code)
		}

		// Case: enabled
		rr3 := httptest.NewRecorder()
		WithConfigGuard(false, "http://service", "MyService", dummyHandler)(rr3, req)
		if rr3.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr3.Code)
		}
	})
}
