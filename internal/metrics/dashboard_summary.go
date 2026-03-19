package metrics

import "time"

// DashboardSummary is the server-side materialized snapshot of all
// cluster/node/pod resource metrics the frontend dashboard needs.
type DashboardSummary struct {
	Cluster   ClusterResources `json:"cluster"`
	Nodes     []NodeResources  `json:"nodes"`
	Pods      []PodResources   `json:"pods"`
	UpdatedAt time.Time        `json:"updated_at"`
}

// ClusterResources holds aggregate cluster-wide CPU and memory.
type ClusterResources struct {
	CPUPercent  float64 `json:"cpu_percent"`
	MemoryUsed  float64 `json:"memory_used"`
	MemoryTotal float64 `json:"memory_total"`
}

// NodeResources holds per-node CPU, memory, and optional GPU metrics.
type NodeResources struct {
	Node       string   `json:"node"`
	CPUPercent *float64 `json:"cpu_percent"`
	MemPercent *float64 `json:"mem_percent"`
	MemUsed    *float64 `json:"mem_used"`
	MemTotal   *float64 `json:"mem_total"`
	GPU        *NodeGPU `json:"gpu,omitempty"`
}

// NodeGPU holds GPU-specific metrics for a node.
type NodeGPU struct {
	Count       int      `json:"count"`
	Utilization *float64 `json:"utilization"`
	VRAMUsed    *float64 `json:"vram_used"`
	VRAMTotal   *float64 `json:"vram_total"`
	Temperature *float64 `json:"temperature"`
	PowerWatts  *float64 `json:"power_watts"`
}

// PodResources holds per-pod CPU and memory usage.
type PodResources struct {
	Namespace   string  `json:"namespace"`
	Pod         string  `json:"pod"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemoryUsed  float64 `json:"memory_used"`
	MemoryLimit float64 `json:"memory_limit"`
}
