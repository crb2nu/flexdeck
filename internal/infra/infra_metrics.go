package infra

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	InfraSnapshotDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "flexdeck_infra_snapshot_duration_seconds",
		Help:    "Duration of an infrastructure snapshot subsystem refresh.",
		Buckets: prometheus.DefBuckets,
	}, []string{"subsystem"})

	InfraSnapshotErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "flexdeck_infra_snapshot_errors_total",
		Help: "Total number of infrastructure snapshot errors.",
	}, []string{"subsystem"})
)
