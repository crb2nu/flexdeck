package rbac

import "time"

// Role represents a user's access level.
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleEditor Role = "editor"
	RoleViewer Role = "viewer"
)

// Permission represents a discrete access right.
type Permission string

const (
	PermRead   Permission = "read"
	PermWrite  Permission = "write"
	PermDelete Permission = "delete"
	PermAdmin  Permission = "admin"
)

// RolePermissions maps each role to its allowed permissions.
var RolePermissions = map[Role][]Permission{
	RoleAdmin:  {PermRead, PermWrite, PermDelete, PermAdmin},
	RoleEditor: {PermRead, PermWrite},
	RoleViewer: {PermRead},
}

// ValidRoles returns all defined roles.
func ValidRoles() []Role {
	return []Role{RoleAdmin, RoleEditor, RoleViewer}
}

// User represents an RBAC user stored in the registry.
type User struct {
	ID        string     `json:"id"`
	Username  string     `json:"username"`
	Role      Role       `json:"role"`
	TokenHash string     `json:"tokenHash"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	LastLogin *time.Time `json:"lastLogin,omitempty"`
	Disabled  bool       `json:"disabled"`
}
