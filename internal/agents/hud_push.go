package agents

import (
	"sync"
	"time"
)

// HUDPushStore caches presence and session data pushed by the local HUD
// webhook. Data expires after a configurable TTL so stale entries disappear
// when the HUD stops pushing.
type HUDPushStore struct {
	mu        sync.RWMutex
	agents    []PresenceInfo
	sessions  []SessionInfo
	updatedAt time.Time
	ttl       time.Duration
}

// NewHUDPushStore creates a push store with the given TTL.
func NewHUDPushStore(ttl time.Duration) *HUDPushStore {
	return &HUDPushStore{ttl: ttl}
}

// Store replaces the cached presence and session data.
func (s *HUDPushStore) Store(agents []PresenceInfo, sessions []SessionInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agents = agents
	s.sessions = sessions
	s.updatedAt = time.Now()
}

// GetPresence returns cached agents if the data has not expired.
// The boolean indicates whether fresh data was available.
func (s *HUDPushStore) GetPresence() (*PresenceResponse, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.updatedAt.IsZero() || time.Since(s.updatedAt) > s.ttl {
		return nil, false
	}
	return &PresenceResponse{Agents: s.agents}, true
}

// GetSessions returns cached sessions if the data has not expired.
// The boolean indicates whether fresh data was available.
func (s *HUDPushStore) GetSessions() (*SessionsResponse, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.updatedAt.IsZero() || time.Since(s.updatedAt) > s.ttl {
		return nil, false
	}
	return &SessionsResponse{Sessions: s.sessions}, true
}
