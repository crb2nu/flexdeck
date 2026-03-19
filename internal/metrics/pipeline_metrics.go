package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	PipelineScrapeDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "flexdeck_pipeline_scrape_duration_seconds",
		Help:    "Duration of a full pipeline scrape cycle.",
		Buckets: prometheus.DefBuckets,
	})
	PipelineScrapeErrors = promauto.NewCounter(prometheus.CounterOpts{
		Name: "flexdeck_pipeline_scrape_errors_total",
		Help: "Total number of pipeline scrape errors.",
	})
	PipelineScrapeProjects = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "flexdeck_pipeline_scrape_projects",
		Help: "Number of projects in the last scrape cycle.",
	})
	PipelineScrapePipelinesStored = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "flexdeck_pipeline_scrape_pipelines_stored",
		Help: "Number of pipeline runs stored in the last scrape cycle.",
	})
)
