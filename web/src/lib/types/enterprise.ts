// === Phase 4: RBAC ===
export interface RBACUser {
  id: string;
  username: string;
  role: "admin" | "editor" | "viewer";
  createdAt: string;
  updatedAt: string;
  lastLogin?: string;
  disabled: boolean;
}

export interface RBACRole {
  name: string;
  permissions: string[];
}

// === Phase 4: Audit Logs ===
export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  remoteAddr: string;
  userId?: string;
  username?: string;
  role?: string;
}

export interface AuditStats {
  total: number;
  byAction: Record<string, number>;
  byUser: Record<string, number>;
  perDay: Array<{ date: string; count: number }>;
}

// === Phase 4: Multi-Cluster ===
export interface ClusterInfo {
  id: string;
  name: string;
  host: string;
  namespace: string;
  readOnly: boolean;
  isDefault: boolean;
  status: "connected" | "disconnected" | "unknown";
  createdAt: string;
}
