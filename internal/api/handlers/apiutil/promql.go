package apiutil

import "strings"

// EscapeLabelValue escapes a string for use as a PromQL label value.
// This prevents injection attacks when user input is used in queries.
func EscapeLabelValue(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}
