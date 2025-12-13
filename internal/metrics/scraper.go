package metrics

import (
	"context"
	"log/slog"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/litellm"
)

// Scraper periodically scrapes LiteLLM metrics and stores them
type Scraper struct {
	litellm  *litellm.Client
	store    *Store
	interval time.Duration
	stopCh   chan struct{}
	doneCh   chan struct{}
}

// NewScraper creates a new metrics scraper
func NewScraper(cfg config.LiteLLMConfig, store *Store) *Scraper {
	return &Scraper{
		litellm:  litellm.NewClient(cfg.URL, cfg.APIKey),
		store:    store,
		interval: cfg.ScrapeInterval,
		stopCh:   make(chan struct{}),
		doneCh:   make(chan struct{}),
	}
}

// Start begins the scraping loop
func (s *Scraper) Start(ctx context.Context) {
	slog.Info("starting litellm metrics scraper", "interval", s.interval)

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	defer close(s.doneCh)

	// Initial scrape
	s.scrape(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.Info("metrics scraper stopping due to context cancellation")
			return
		case <-s.stopCh:
			slog.Info("metrics scraper stopping")
			return
		case <-ticker.C:
			s.scrape(ctx)
		}
	}
}

// Stop stops the scraper
func (s *Scraper) Stop() {
	close(s.stopCh)
	<-s.doneCh // Wait for scraper to finish
}

func (s *Scraper) scrape(ctx context.Context) {
	scrapeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	metrics, err := s.litellm.ScrapeMetrics(scrapeCtx)
	if err != nil {
		slog.Warn("failed to scrape litellm metrics", "error", err)
		return
	}

	if len(metrics) == 0 {
		slog.Debug("no metrics scraped from litellm")
		return
	}

	if err := s.store.StoreMetrics(scrapeCtx, metrics); err != nil {
		slog.Warn("failed to store metrics", "error", err)
		return
	}

	slog.Debug("scraped litellm metrics", "models", len(metrics))
}

// LiteLLMClient returns the underlying LiteLLM client for health checks
func (s *Scraper) LiteLLMClient() *litellm.Client {
	return s.litellm
}
