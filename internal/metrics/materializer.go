package metrics

import (
	"context"
	"log/slog"
	"time"
)

// Materializer periodically refreshes pre-computed Redis summaries so
// dashboard reads never fall back to full SCAN+compute loops.
type Materializer struct {
	store   *Store
	promURL string
	stopCh  chan struct{}
	doneCh  chan struct{}
}

// NewMaterializer creates a Materializer that refreshes summary keys using store.
// If promURL is non-empty, a fast 15s ticker also materializes the dashboard
// resource summary from Prometheus.
func NewMaterializer(store *Store, promURL string) *Materializer {
	return &Materializer{
		store:   store,
		promURL: promURL,
		stopCh:  make(chan struct{}),
		doneCh:  make(chan struct{}),
	}
}

// Start runs two tickers:
//   - Slow (2min): throughput + pipeline trend summaries
//   - Fast (15s):  dashboard resource summary (only when promURL is set)
//
// It blocks until Stop is called or ctx is cancelled.
func (m *Materializer) Start(ctx context.Context) {
	slog.Info("starting summary materializer",
		"slow_interval", 2*time.Minute,
		"fast_interval", 15*time.Second,
		"prom_enabled", m.promURL != "",
	)

	slowTicker := time.NewTicker(2 * time.Minute)
	defer slowTicker.Stop()
	defer close(m.doneCh)

	// Initial refresh.
	m.refreshSlow(ctx)

	var fastTickerC <-chan time.Time
	var fastTicker *time.Ticker
	if m.promURL != "" {
		fastTicker = time.NewTicker(15 * time.Second)
		fastTickerC = fastTicker.C
		defer fastTicker.Stop()
		m.refreshFast(ctx)
	}

	for {
		select {
		case <-ctx.Done():
			slog.Info("materializer stopping due to context cancellation")
			return
		case <-m.stopCh:
			slog.Info("materializer stopping")
			return
		case <-slowTicker.C:
			m.refreshSlow(ctx)
		case <-fastTickerC:
			m.refreshFast(ctx)
		}
	}
}

// Stop signals the materializer to exit and waits for it to finish.
func (m *Materializer) Stop() {
	close(m.stopCh)
	<-m.doneCh
}

func (m *Materializer) refreshSlow(ctx context.Context) {
	m.store.MaterializeThroughput(ctx)
	m.store.MaterializeAllPipelineTrends(ctx)
	slog.Debug("materializer refreshed slow summaries")
}

func (m *Materializer) refreshFast(ctx context.Context) {
	if m.promURL == "" {
		return
	}
	m.store.MaterializeDashboardSummary(ctx, m.promURL)
	slog.Debug("materializer refreshed dashboard summary")
}
