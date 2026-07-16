// Package trustednetwork authorizes requests from an operator-configured
// network allowlist.
package trustednetwork

import (
	"net"
	"net/http"
	"strings"
)

// Allowlist contains the client networks that may bypass interactive auth.
// An empty allowlist disables the bypass.
type Allowlist struct {
	networks []*net.IPNet
}

// Parse accepts comma, semicolon, or whitespace-separated CIDRs. Bare IPs are
// treated as single-host networks. Invalid entries are ignored, so a malformed
// value fails closed instead of widening access.
func Parse(value string) Allowlist {
	fields := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\t'
	})
	networks := make([]*net.IPNet, 0, len(fields))

	for _, field := range fields {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}

		if _, network, err := net.ParseCIDR(field); err == nil {
			networks = append(networks, network)
			continue
		}

		if ip := net.ParseIP(field); ip != nil {
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			networks = append(networks, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
		}
	}

	return Allowlist{networks: networks}
}

// Contains reports whether the request's client IP is in the allowlist.
func (a Allowlist) Contains(r *http.Request) bool {
	if len(a.networks) == 0 {
		return false
	}

	ip := ClientIP(r)
	if ip == nil {
		return false
	}

	for _, network := range a.networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// ClientIP returns the ingress-reported client IP, falling back to RemoteAddr.
// The deployment trusts its nginx ingress to replace these forwarding headers.
func ClientIP(r *http.Request) net.IP {
	if r == nil {
		return nil
	}

	if value := strings.TrimSpace(r.Header.Get("X-Real-IP")); value != "" {
		if ip := net.ParseIP(value); ip != nil {
			return ip
		}
	}

	if value := r.Header.Get("X-Forwarded-For"); value != "" {
		first := strings.TrimSpace(strings.Split(value, ",")[0])
		if ip := net.ParseIP(first); ip != nil {
			return ip
		}
	}

	host := r.RemoteAddr
	if parsedHost, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = parsedHost
	}
	return net.ParseIP(strings.TrimSpace(host))
}
