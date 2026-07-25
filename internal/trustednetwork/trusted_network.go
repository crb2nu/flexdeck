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

// ContainsIP reports whether the IP is inside the allowlist.
func (a Allowlist) ContainsIP(ip net.IP) bool {
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

// Trust pairs the trusted-client allowlist with the reverse proxies whose
// forwarding headers may be believed. X-Real-IP / X-Forwarded-For are honored
// only when the direct peer (RemoteAddr) is a configured proxy; otherwise the
// peer address itself is the client IP. An empty proxy list means forwarding
// headers are never trusted, so a deployment reachable without its ingress
// (NodePort, port-forward, direct pod access) cannot spoof a trusted client.
type Trust struct {
	clients Allowlist
	proxies Allowlist
}

// NewTrust parses the client and proxy CIDR lists into a Trust.
func NewTrust(clientCIDRs, proxyCIDRs string) Trust {
	return Trust{clients: Parse(clientCIDRs), proxies: Parse(proxyCIDRs)}
}

// Trusted reports whether the request's client IP is in the client allowlist.
func (t Trust) Trusted(r *http.Request) bool {
	return t.clients.ContainsIP(t.ClientIP(r))
}

// ClientIP resolves the request's client IP. Forwarding headers are consulted
// only for requests arriving from a trusted proxy.
func (t Trust) ClientIP(r *http.Request) net.IP {
	if r == nil {
		return nil
	}

	peer := peerIP(r.RemoteAddr)
	if !t.proxies.ContainsIP(peer) {
		return peer
	}

	if ip := forwardedIP(r); ip != nil {
		return ip
	}
	return peer
}

// RealIPHandler rewrites RemoteAddr to the proxy-reported client IP, but only
// when the direct peer is a trusted proxy. Drop-in replacement for chi's
// middleware.RealIP, which trusts the headers unconditionally.
func (t Trust) RealIPHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if t.proxies.ContainsIP(peerIP(r.RemoteAddr)) {
			if ip := forwardedIP(r); ip != nil {
				r.RemoteAddr = ip.String()
			}
		}
		next.ServeHTTP(w, r)
	})
}

// forwardedIP extracts the client IP asserted by a reverse proxy's headers.
func forwardedIP(r *http.Request) net.IP {
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

	return nil
}

// peerIP parses the transport-level peer address, with or without a port.
func peerIP(remoteAddr string) net.IP {
	host := remoteAddr
	if parsedHost, _, err := net.SplitHostPort(remoteAddr); err == nil {
		host = parsedHost
	}
	return net.ParseIP(strings.TrimSpace(host))
}
