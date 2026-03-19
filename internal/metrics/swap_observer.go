package metrics

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/flexinfer/flexdeck/internal/k8s"
)

// swapState tracks the last known shared-group state for a model.
type swapState struct {
	state       string
	changedAt   time.Time
	group       string
	preemptedBy string
}

// StartSwapObserver watches FlexInfer Model CRD changes and records GPU swap events.
// It runs as a background goroutine and reconnects on watch channel close.
func StartSwapObserver(ctx context.Context, k8sClient *k8s.Client, store *Store, namespace string, logger *slog.Logger) {
	logger = logger.With("component", "swap-observer", "namespace", namespace)
	logger.Info("starting GPU swap observer")

	for {
		if err := runSwapWatch(ctx, k8sClient, store, namespace, logger); err != nil {
			logger.Warn("swap watch ended", "error", err)
		}

		select {
		case <-ctx.Done():
			logger.Info("swap observer stopped")
			return
		case <-time.After(5 * time.Second):
			logger.Info("reconnecting swap watch")
		}
	}
}

// runSwapWatch runs a single watch session, returning when the channel closes or ctx is cancelled.
func runSwapWatch(ctx context.Context, k8sClient *k8s.Client, store *Store, namespace string, logger *slog.Logger) error {
	events, err := k8sClient.WatchFlexInferModels(ctx, namespace)
	if err != nil {
		return err
	}

	var mu sync.Mutex
	states := make(map[string]*swapState) // key: "namespace/name"

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case event, ok := <-events:
			if !ok {
				return nil // channel closed, reconnect
			}
			processSwapEvent(ctx, store, logger, &mu, states, event)
		}
	}
}

// processSwapEvent handles a single model watch event for swap tracking.
func processSwapEvent(
	ctx context.Context,
	store *Store,
	logger *slog.Logger,
	mu *sync.Mutex,
	states map[string]*swapState,
	event k8s.ModelWatchEvent,
) {
	if event.Model == nil {
		return
	}

	model := event.Model
	key := model.Namespace + "/" + model.Name

	mu.Lock()
	defer mu.Unlock()

	switch event.Type {
	case "ADDED":
		seedSwapState(states, key, model)

	case "MODIFIED":
		handleSwapModified(ctx, store, logger, states, key, model)

	case "DELETED":
		delete(states, key)
	}
}

// seedSwapState records the initial state for a model without storing an event.
func seedSwapState(states map[string]*swapState, key string, model *k8s.FlexInferModel) {
	sg := model.Status.SharedGroup
	if sg == nil {
		return
	}
	states[key] = &swapState{
		state:       sg.State,
		changedAt:   time.Now(),
		group:       sg.GroupName,
		preemptedBy: sg.PreemptedBy,
	}
}

// handleSwapModified detects state changes and stores swap events.
func handleSwapModified(
	ctx context.Context,
	store *Store,
	logger *slog.Logger,
	states map[string]*swapState,
	key string,
	model *k8s.FlexInferModel,
) {
	sg := model.Status.SharedGroup
	if sg == nil {
		return
	}

	prev, exists := states[key]
	if !exists {
		// First time seeing this model, seed state
		seedSwapState(states, key, model)
		return
	}

	newState := sg.State
	if newState == prev.state {
		return // no state change
	}

	now := time.Now()
	duration := now.Sub(prev.changedAt).Seconds()

	event := GPUSwapEvent{
		Timestamp:   now,
		Model:       model.Name,
		Namespace:   model.Namespace,
		Group:       sg.GroupName,
		OldState:    prev.state,
		NewState:    newState,
		PreemptedBy: sg.PreemptedBy,
		DurationSec: duration,
	}

	if err := store.StoreSwapEvent(ctx, event); err != nil {
		logger.Warn("failed to store swap event",
			"model", model.Name, "error", err)
	} else {
		logger.Debug("swap event recorded",
			"model", model.Name,
			"transition", prev.state+"->"+newState,
			"duration_s", duration)
	}

	// Update tracked state
	states[key] = &swapState{
		state:       newState,
		changedAt:   now,
		group:       sg.GroupName,
		preemptedBy: sg.PreemptedBy,
	}
}
