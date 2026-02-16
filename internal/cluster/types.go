package cluster

import "time"

// ClusterInfo represents a registered Kubernetes cluster.
type ClusterInfo struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Host          string    `json:"host"`
	Token         string    `json:"token,omitempty"`
	CAFile        string    `json:"caFile,omitempty"`
	SkipTLSVerify bool      `json:"skipTLSVerify"`
	Namespace     string    `json:"namespace"`
	ReadOnly      bool      `json:"readOnly"`
	IsDefault     bool      `json:"isDefault"`
	Status        string    `json:"status"` // "connected", "disconnected", "unknown"
	CreatedAt     time.Time `json:"createdAt"`
}

// Redacted returns a copy with the token masked.
func (c *ClusterInfo) Redacted() ClusterInfo {
	cp := *c
	if len(cp.Token) > 4 {
		cp.Token = "****" + cp.Token[len(cp.Token)-4:]
	} else if cp.Token != "" {
		cp.Token = "****"
	}
	return cp
}
