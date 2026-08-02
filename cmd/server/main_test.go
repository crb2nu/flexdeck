package main

import (
	"reflect"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestRuntimePlanFor(t *testing.T) {
	fullRuntime := runtimePlan{
		metricsScraper:  true,
		pipelineScraper: true,
		materializer:    true,
		modelRegistry:   true,
		modelManagement: true,
		agents:          true,
		rbac:            true,
		audit:           true,
		multiCluster:    true,
		hud:             true,
		infra:           true,
		swapObserver:    true,
	}
	publicRuntime := runtimePlan{modelRegistry: true}

	for _, test := range []struct {
		name string
		cfg  *config.Config
		want runtimePlan
	}{
		{name: "default full runtime", cfg: &config.Config{}, want: fullRuntime},
		{name: "public API only keeps read-only model registry", cfg: &config.Config{PublicAPIOnly: true}, want: publicRuntime},
		{name: "public API only honors disabled models", cfg: &config.Config{PublicAPIOnly: true, Models: config.ModelsConfig{Disabled: true}}, want: runtimePlan{}},
		{name: "missing config", cfg: nil, want: runtimePlan{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := runtimePlanFor(test.cfg); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("runtimePlanFor() = %+v, want %+v", got, test.want)
			}
		})
	}
}
