package trustednetwork

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseAndContains(t *testing.T) {
	allowlist := Parse("192.168.50.0/24, 10.0.0.5 ;bogus/xx fe80::/10")

	if !allowlist.Contains(requestFrom("10.42.0.8:8080", "192.168.50.153", "")) {
		t.Fatal("LAN address should be trusted")
	}
	if !allowlist.Contains(requestFrom("10.0.0.5:8080", "", "")) {
		t.Fatal("bare IP should be treated as a host route")
	}
	if allowlist.Contains(requestFrom("10.42.0.8:8080", "192.168.99.7", "")) {
		t.Fatal("off-subnet address must not be trusted")
	}
	if Parse("bogus/xx").Contains(requestFrom("192.168.50.153:8080", "", "")) {
		t.Fatal("invalid-only allowlist must fail closed")
	}
}

func TestClientIPPrecedence(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		xRealIP    string
		xff        string
		want       string
	}{
		{name: "x-real-ip", remoteAddr: "10.42.0.8:8080", xRealIP: "192.168.50.153", xff: "203.0.113.8", want: "192.168.50.153"},
		{name: "leftmost-x-forwarded-for", remoteAddr: "10.42.0.8:8080", xff: "192.168.50.154, 10.42.0.1", want: "192.168.50.154"},
		{name: "remote-address", remoteAddr: "192.168.50.155:44321", want: "192.168.50.155"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClientIP(requestFrom(tt.remoteAddr, tt.xRealIP, tt.xff)); got == nil || got.String() != tt.want {
				t.Fatalf("ClientIP() = %v, want %s", got, tt.want)
			}
		})
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
