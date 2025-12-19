package apiutil

import (
	"net/url"
	"strings"
)

// URLBuilder provides a fluent interface for building URLs safely.
type URLBuilder struct {
	base   string
	path   string
	params url.Values
}

// NewURLBuilder creates a new URL builder with the given base URL.
func NewURLBuilder(base string) *URLBuilder {
	return &URLBuilder{
		base:   strings.TrimRight(base, "/"),
		params: url.Values{},
	}
}

// Path appends path segments (each segment is escaped).
func (b *URLBuilder) Path(segments ...string) *URLBuilder {
	for _, s := range segments {
		b.path += "/" + url.PathEscape(s)
	}
	return b
}

// RawPath appends a raw path string without escaping.
// Use this for paths that are already properly formatted.
func (b *URLBuilder) RawPath(path string) *URLBuilder {
	if !strings.HasPrefix(path, "/") {
		b.path += "/"
	}
	b.path += path
	return b
}

// Param adds a query parameter. Empty values are skipped.
func (b *URLBuilder) Param(key, value string) *URLBuilder {
	if value != "" {
		b.params.Set(key, value)
	}
	return b
}

// ParamInt adds an integer query parameter. Zero values are skipped.
func (b *URLBuilder) ParamInt(key string, value int) *URLBuilder {
	if value != 0 {
		b.params.Set(key, url.QueryEscape(string(rune(value))))
	}
	return b
}

// Params adds multiple query parameters from a map. Empty values are skipped.
func (b *URLBuilder) Params(params map[string]string) *URLBuilder {
	for k, v := range params {
		b.Param(k, v)
	}
	return b
}

// String returns the built URL.
func (b *URLBuilder) String() string {
	result := b.base + b.path
	if len(b.params) > 0 {
		result += "?" + b.params.Encode()
	}
	return result
}
