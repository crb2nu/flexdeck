package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/rbac"
)

// RBACListUsers returns all users (admin only).
func (h *Handler) RBACListUsers(w http.ResponseWriter, r *http.Request) {
	if h.rbacRegistry == nil {
		http.Error(w, "rbac disabled", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(h.rbacRegistry.List())
}

// RBACGetUser returns a single user by ID (admin only).
func (h *Handler) RBACGetUser(w http.ResponseWriter, r *http.Request) {
	if h.rbacRegistry == nil {
		http.Error(w, "rbac disabled", http.StatusServiceUnavailable)
		return
	}
	user, err := h.rbacRegistry.Get(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(user)
}

// RBACCreateUser creates a new user and returns the one-time plaintext token.
func (h *Handler) RBACCreateUser(w http.ResponseWriter, r *http.Request) {
	if h.rbacRegistry == nil {
		http.Error(w, "rbac disabled", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Username == "" {
		http.Error(w, "username is required", http.StatusBadRequest)
		return
	}
	role := rbac.Role(req.Role)
	if role != rbac.RoleAdmin && role != rbac.RoleEditor && role != rbac.RoleViewer {
		http.Error(w, "invalid role: must be admin, editor, or viewer", http.StatusBadRequest)
		return
	}

	user, token, err := h.rbacRegistry.Create(req.Username, role)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":        user.ID,
		"username":  user.Username,
		"role":      user.Role,
		"token":     token,
		"createdAt": user.CreatedAt,
	})
}

// RBACUpdateUser modifies a user's role or disabled status.
func (h *Handler) RBACUpdateUser(w http.ResponseWriter, r *http.Request) {
	if h.rbacRegistry == nil {
		http.Error(w, "rbac disabled", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Role     *string `json:"role,omitempty"`
		Disabled *bool   `json:"disabled,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	var role *rbac.Role
	if req.Role != nil {
		r := rbac.Role(*req.Role)
		if r != rbac.RoleAdmin && r != rbac.RoleEditor && r != rbac.RoleViewer {
			http.Error(w, "invalid role", http.StatusBadRequest)
			return
		}
		role = &r
	}

	user, err := h.rbacRegistry.Update(chi.URLParam(r, "id"), role, req.Disabled)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(user)
}

// RBACDeleteUser removes a user.
func (h *Handler) RBACDeleteUser(w http.ResponseWriter, r *http.Request) {
	if h.rbacRegistry == nil {
		http.Error(w, "rbac disabled", http.StatusServiceUnavailable)
		return
	}

	if err := h.rbacRegistry.Delete(chi.URLParam(r, "id")); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RBACCurrentUser returns the authenticated user's info.
func (h *Handler) RBACCurrentUser(w http.ResponseWriter, r *http.Request) {
	user := rbac.UserFromContext(r.Context())
	if user == nil {
		http.Error(w, "no user in context", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(user)
}

// RBACRoles returns all available roles and their permissions.
func (h *Handler) RBACRoles(w http.ResponseWriter, r *http.Request) {
	type roleInfo struct {
		Name        rbac.Role        `json:"name"`
		Permissions []rbac.Permission `json:"permissions"`
	}

	roles := make([]roleInfo, 0, len(rbac.RolePermissions))
	for _, role := range rbac.ValidRoles() {
		roles = append(roles, roleInfo{
			Name:        role,
			Permissions: rbac.RolePermissions[role],
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(roles)
}
