package trustednetwork

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

const proxyCIDR = "10.42.0.0/16"

func TestParseAndTrusted(t *testing.T) {
	trust := NewTrust("192.168.50.0/24, 10.0.0.5 ;bogus/xx fe80::/10", proxyCIDR)

	if !trust.Trusted(requestFrom("10.42.0.8:8080", "192.168.50.153", "")) {
		t.Fatal("LAN address forwarded by the ingress should be trusted")
	}
	if !trust.Trusted(requestFrom("10.0.0.5:8080", "", "")) {
		t.Fatal("bare IP should be treated as a host route")
	}
	if trust.Trusted(requestFrom("10.42.0.8:8080", "192.168.99.7", "")) {
		t.Fatal("off-subnet address must not be trusted")
	}
	if NewTrust("bogus/xx", proxyCIDR).Trusted(requestFrom("192.168.50.153:8080", "", "")) {
		t.Fatal("invalid-only allowlist must fail closed")
	}
}

func TestTrustedRejectsSpoofedHeadersFromUntrustedPeer(t *testing.T) {
	trust := NewTrust("192.168.50.0/24", proxyCIDR)

	// A client reaching the service without the ingress in front (NodePort,
	// port-forward, direct pod access) must not be able to spoof a LAN IP.
	if trust.Trusted(requestFrom("203.0.113.9:31234", "192.168.50.153", "")) {
		t.Fatal("X-Real-IP from an untrusted peer must not bypass auth")
	}
	if trust.Trusted(requestFrom("203.0.113.9:31234", "", "192.168.50.153")) {
		t.Fatal("X-Forwarded-For from an untrusted peer must not bypass auth")
	}

	// With no proxy allowlist configured, headers are never believed —
	// even from a peer that would otherwise be a proxy.
	if NewTrust("192.168.50.0/24", "").Trusted(requestFrom("10.42.0.8:8080", "192.168.50.153", "")) {
		t.Fatal("empty proxy allowlist must fail closed for forwarded headers")
	}

	// A direct connection from the LAN itself still qualifies.
	if !trust.Trusted(requestFrom("192.168.50.153:44321", "", "")) {
		t.Fatal("direct LAN peer should be trusted without headers")
	}
}

func TestClientIPPrecedence(t *testing.T) {
	tests := []struct {
		name       string
		proxies    string
		remoteAddr string
		xRealIP    string
		xff        string
		want       string
	}{
		{name: "x-real-ip-via-proxy", proxies: proxyCIDR, remoteAddr: "10.42.0.8:8080", xRealIP: "192.168.50.153", xff: "203.0.113.8", want: "192.168.50.153"},
		{name: "leftmost-x-forwarded-for-via-proxy", proxies: proxyCIDR, remoteAddr: "10.42.0.8:8080", xff: "192.168.50.154, 10.42.0.1", want: "192.168.50.154"},
		{name: "remote-address", proxies: proxyCIDR, remoteAddr: "192.168.50.155:44321", want: "192.168.50.155"},
		{name: "headers-ignored-from-untrusted-peer", proxies: proxyCIDR, remoteAddr: "203.0.113.9:31234", xRealIP: "192.168.50.153", want: "203.0.113.9"},
		{name: "headers-ignored-without-proxy-config", proxies: "", remoteAddr: "10.42.0.8:8080", xRealIP: "192.168.50.153", want: "10.42.0.8"},
		{name: "proxy-with-blank-headers-falls-back-to-peer", proxies: proxyCIDR, remoteAddr: "10.42.0.8:8080", want: "10.42.0.8"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trust := NewTrust("", tt.proxies)
			if got := trust.ClientIP(requestFrom(tt.remoteAddr, tt.xRealIP, tt.xff)); got == nil || got.String() != tt.want {
				t.Fatalf("ClientIP() = %v, want %s", got, tt.want)
			}
		})
	}
}

func TestRealIPHandler(t *testing.T) {
	trust := NewTrust("", proxyCIDR)

	var seen string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.RemoteAddr
	})
	handler := trust.RealIPHandler(next)

	handler.ServeHTTP(httptest.NewRecorder(), requestFrom("10.42.0.8:8080", "192.168.50.153", ""))
	if seen != "192.168.50.153" {
		t.Fatalf("proxy-forwarded RemoteAddr = %q, want 192.168.50.153", seen)
	}

	handler.ServeHTTP(httptest.NewRecorder(), requestFrom("203.0.113.9:31234", "192.168.50.153", ""))
	if seen != "203.0.113.9:31234" {
		t.Fatalf("untrusted-peer RemoteAddr = %q, want unchanged 203.0.113.9:31234", seen)
	}
}

func requestFrom(remoteAddr, xRealIP, xff string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/rbac/me", nil)
	req.RemoteAddr = remoteAddr
	if xRealIP != "" {
		req.Header.Set("X-Real-IP", xRealIP)
	}
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	return req
}
