package handlers

import (
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
)

type Handler struct {
	cfg *config.Config
	k8s *k8s.Client
}

func New(cfg *config.Config, k8sClient *k8s.Client) *Handler {
	return &Handler{
		cfg: cfg,
		k8s: k8sClient,
	}
}
