package metrics

import (
	"context"
	"log/slog"
	"time"
)

// Materializer periodically refreshes pre-computed Redis summaries so
// dashboard reads never fall back to full SCAN+compute loops.
type Materializer struct {
	store  *Store
	stopCh chan struct{}
	doneCh chan struct{}
}

// NewMaterializer creates a Materializer that refreshes summary keys using store.
func NewMaterializer(store *Store) *Materializer {
	return &Materializer{
		store:  store,
		stopCh: make(chan struct{}),
		doneCh: make(chan struct{}),
	}
}

// Start runs a 2-minute ticker that refreshes throughput and pipeline trend
// summaries. It blocks until Stop is called or ctx is cancelled.
func (m *Materializer) Start(ctx context.Context) {
	slog.Info("starting summary materializer", "interval", 2*time.Minute)

	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	defer close(m.doneCh)

	// Initial refresh.
	m.refresh(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.Info("materializer stopping due to context cancellation")
			return
		case <-m.stopCh:
			slog.Info("materializer stopping")
			return
		case <-ticker.C:
			m.refresh(ctx)
		}
	}
}

// Stop signals the materializer to exit and waits for it to finish.
func (m *Materializer) Stop() {
	close(m.stopCh)
	<-m.doneCh
}

func (m *Materializer) refresh(ctx context.Context) {
	m.store.MaterializeThroughput(ctx)
	m.store.MaterializeAllPipelineTrends(ctx)
	slog.Debug("materializer refreshed summaries")
}
