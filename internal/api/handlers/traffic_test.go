package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestTrafficReportBuildsPrometheusSummary(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		w.Header().Set("Content-Type", "application/json")

		switch {
		case strings.Contains(query, `status=~"4.."`) && strings.Contains(query, "offset"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"host":"flexinfer.ai"},"value":[1710000000,"1"]}]}}`))
		case strings.Contains(query, `status=~"4.."`):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"host":"flexinfer.ai"},"value":[1710000000,"3"]}]}}`))
		case strings.Contains(query, `status=~"5.."`) && strings.Contains(query, "offset"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"host":"flexinfer.ai"},"value":[1710000000,"0"]}]}}`))
		case strings.Contains(query, `status=~"5.."`):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"host":"flexinfer.ai"},"value":[1710000000,"1"]}]}}`))
		case strings.Contains(query, "nginx_ingress_controller_requests") && strings.Contains(query, "increase") && strings.Contains(query, "sum by (host)"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"host":"flexinfer.ai"},"value":[1710000000,"120"]}]}}`))
		case strings.Contains(query, "nginx_ingress_controller_requests") && strings.Contains(query, "rate") && strings.Contains(query, "sum by (host)"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"host":"flexinfer.ai"},"value":[1710000000,"0.4"]}]}}`))
		case strings.Contains(query, "request_duration_seconds_bucket"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"host":"flexinfer.ai"},"value":[1710000000,"0.25"]}]}}`))
		case strings.Contains(query, "sum by (host, path)"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"host":"flexinfer.ai","path":"/"},"value":[1710000000,"80"]}]}}`))
		case strings.Contains(query, "flexinfer_page_views_total") && strings.Contains(query, "topk"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"page":"/"},"value":[1710000000,"42"]}]}}`))
		case strings.Contains(query, "count(flexinfer_page_views_total)"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{},"value":[1710000000,"2"]}]}}`))
		case strings.Contains(query, "count(flexinfer_http_requests_total)"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{},"value":[1710000000,"4"]}]}}`))
		case strings.Contains(query, "up{"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{"namespace":"flexinfer-site","service":"flexinfer-site","pod":"flexinfer-site-abc"},"value":[1710000000,"1"]}]}}`))
		default:
			t.Fatalf("unexpected query: %s", query)
		}
	}))
	defer ts.Close()

	h := &Handler{cfg: &config.Config{}}
	h.cfg.Prom.URL = ts.URL

	req := httptest.NewRequest(http.MethodGet, "/api/traffic/report?window=24h", nil)
	rr := httptest.NewRecorder()
	h.TrafficReport(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var report TrafficReport
	if err := json.Unmarshal(rr.Body.Bytes(), &report); err != nil {
		t.Fatalf("failed to unmarshal report: %v", err)
	}

	if report.Window != "24h" || report.Status != "ok" {
		t.Fatalf("unexpected report status/window: %+v", report)
	}
	if len(report.Hosts) != 1 || report.Hosts[0].Host != "flexinfer.ai" {
		t.Fatalf("expected flexinfer.ai host, got %+v", report.Hosts)
	}
	if report.Hosts[0].Requests != 120 || report.Hosts[0].RequestsPerSecond != 0.4 {
		t.Fatalf("unexpected host metrics: %+v", report.Hosts[0])
	}
	if report.Hosts[0].FourXX != 3 || report.Hosts[0].FourXXPrev != 1 || report.Hosts[0].FourXXChange != 2 {
		t.Fatalf("unexpected host 4xx change metrics: %+v", report.Hosts[0])
	}
	if report.Hosts[0].FiveXX != 1 || report.Hosts[0].FiveXXPrev != 0 || report.Hosts[0].FiveXXChange != 1 {
		t.Fatalf("unexpected host 5xx change metrics: %+v", report.Hosts[0])
	}
	if report.Hosts[0].P95LatencyMs != 250 {
		t.Fatalf("expected p95 latency in ms, got %f", report.Hosts[0].P95LatencyMs)
	}
	if len(report.TopPages) != 1 || report.TopPages[0].Views != 42 {
		t.Fatalf("expected page view summary, got %+v", report.TopPages)
	}
	if len(report.TrackingSignals) < 3 {
		t.Fatalf("expected tracking signals, got %+v", report.TrackingSignals)
	}
}

func TestSanitizeTrafficWindow(t *testing.T) {
	if got := sanitizeTrafficWindow("7d"); got != "7d" {
		t.Fatalf("expected 7d, got %s", got)
	}
	if got := sanitizeTrafficWindow("24h] or vector(1)"); got != defaultTrafficWindow {
		t.Fatalf("expected default window, got %s", got)
	}
}
