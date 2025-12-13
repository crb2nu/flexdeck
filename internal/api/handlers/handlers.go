package handlers

import (
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/flexinfer/flexdeck/internal/litellm"
	"github.com/flexinfer/flexdeck/internal/metrics"
)

type Handler struct {
	cfg          *config.Config
	k8s          *k8s.Client
	litellm      *litellm.Client
	metricsStore *metrics.Store
}

func New(cfg *config.Config, k8sClient *k8s.Client, litellmClient *litellm.Client, metricsStore *metrics.Store) *Handler {
	return &Handler{
		cfg:          cfg,
		k8s:          k8sClient,
		litellm:      litellmClient,
		metricsStore: metricsStore,
	}
}
