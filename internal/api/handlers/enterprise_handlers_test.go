package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/flexinfer/flexdeck/internal/audit"
	"github.com/flexinfer/flexdeck/internal/cluster"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/rbac"
)

func newEnterpriseTestHandler(t *testing.T) *Handler {
	t.Helper()

	tempDir := t.TempDir()
	rbacRegistry, err := rbac.NewRegistry(config.RBACConfig{
		UsersPath: filepath.Join(tempDir, "rbac-users.json"),
	})
	if err != nil {
		t.Fatalf("NewRegistry(rbac): %v", err)
	}

	clusterRegistry, err := cluster.NewRegistry(
		config.MultiClusterConfig{RegistryPath: filepath.Join(tempDir, "clusters.json")},
		config.K8sConfig{Disabled: true},
	)
	if err != nil {
		t.Fatalf("NewRegistry(cluster): %v", err)
	}

	redisServer, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(redisServer.Close)

	redisClient := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = redisClient.Close() })

	return &Handler{
		cfg:             &config.Config{},
		rbacRegistry:    rbacRegistry,
		auditStore:      audit.NewStore(redisClient, 7),
		clusterRegistry: clusterRegistry,
		clusterManager:  cluster.NewManager(clusterRegistry),
	}
}

func TestEnterpriseHandlersDisabledPaths(t *testing.T) {
	h := &Handler{cfg: &config.Config{}}

	cases := []struct {
		name   string
		req    *http.Request
		handle func(http.ResponseWriter, *http.Request)
	}{
		{"RBACListUsers", httptest.NewRequest(http.MethodGet, "/api/rbac/users", nil), h.RBACListUsers},
		{"RBACGetUser", requestWithID(http.MethodGet, "/api/rbac/users/missing", "missing", nil), h.RBACGetUser},
		{"RBACCreateUser", httptest.NewRequest(http.MethodPost, "/api/rbac/users", bytes.NewReader(mustJSON(t, map[string]string{"username": "alice", "role": "admin"}))), h.RBACCreateUser},
		{"RBACUpdateUser", requestWithID(http.MethodPut, "/api/rbac/users/missing", "missing", mustJSON(t, map[string]string{"role": "viewer"})), h.RBACUpdateUser},
		{"RBACDeleteUser", requestWithID(http.MethodDelete, "/api/rbac/users/missing", "missing", nil), h.RBACDeleteUser},
		{"AuditList", httptest.NewRequest(http.MethodGet, "/api/audit/", nil), h.AuditList},
		{"AuditStats", httptest.NewRequest(http.MethodGet, "/api/audit/stats", nil), h.AuditStats},
		{"ClustersList", httptest.NewRequest(http.MethodGet, "/api/clusters/", nil), h.ClustersList},
		{"ClustersGet", requestWithID(http.MethodGet, "/api/clusters/missing", "missing", nil), h.ClustersGet},
		{"ClustersCreate", httptest.NewRequest(http.MethodPost, "/api/clusters/", bytes.NewReader(mustJSON(t, cluster.ClusterInfo{Name: "prod", Host: "https://prod.test"}))), h.ClustersCreate},
		{"ClustersUpdate", requestWithID(http.MethodPut, "/api/clusters/missing", "missing", mustJSON(t, cluster.ClusterInfo{Name: "prod", Host: "https://prod.test"})), h.ClustersUpdate},
		{"ClustersDelete", requestWithID(http.MethodDelete, "/api/clusters/missing", "missing", nil), h.ClustersDelete},
		{"ClustersTest", requestWithID(http.MethodPost, "/api/clusters/missing/test", "missing", nil), h.ClustersTest},
		{"ClustersSetDefault", requestWithID(http.MethodPost, "/api/clusters/missing/default", "missing", nil), h.ClustersSetDefault},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tc.handle(w, tc.req)
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected 503, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestRBACHandlers(t *testing.T) {
	h := newEnterpriseTestHandler(t)

	t.Run("create validates request body", func(t *testing.T) {
		for _, body := range [][]byte{
			[]byte("{bad json"),
			mustJSON(t, map[string]string{"role": "admin"}),
			mustJSON(t, map[string]string{"username": "alice", "role": "owner"}),
		} {
			w := httptest.NewRecorder()
			h.RBACCreateUser(w, httptest.NewRequest(http.MethodPost, "/api/rbac/users", bytes.NewReader(body)))
			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for body %q, got %d", string(body), w.Code)
			}
		}
	})

	createBody := mustJSON(t, map[string]string{"username": "alice", "role": "editor"})
	createResp := httptest.NewRecorder()
	h.RBACCreateUser(createResp, httptest.NewRequest(http.MethodPost, "/api/rbac/users", bytes.NewReader(createBody)))
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201: %s", createResp.Code, createResp.Body.String())
	}

	created := decodeBody(t, createResp)
	userID, _ := created["id"].(string)
	if userID == "" {
		t.Fatalf("create response missing id: %#v", created)
	}
	if token, _ := created["token"].(string); token == "" {
		t.Fatalf("create response missing one-time token: %#v", created)
	}

	duplicateResp := httptest.NewRecorder()
	h.RBACCreateUser(duplicateResp, httptest.NewRequest(http.MethodPost, "/api/rbac/users", bytes.NewReader(createBody)))
	if duplicateResp.Code != http.StatusConflict {
		t.Fatalf("duplicate create status = %d, want 409", duplicateResp.Code)
	}

	listResp := httptest.NewRecorder()
	h.RBACListUsers(listResp, httptest.NewRequest(http.MethodGet, "/api/rbac/users", nil))
	if listResp.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", listResp.Code)
	}
	var users []rbac.User
	if err := json.Unmarshal(listResp.Body.Bytes(), &users); err != nil {
		t.Fatalf("decode users: %v", err)
	}
	if len(users) != 1 || users[0].Username != "alice" || users[0].TokenHash != "" {
		t.Fatalf("unexpected list response: %#v", users)
	}

	getResp := httptest.NewRecorder()
	h.RBACGetUser(getResp, requestWithID(http.MethodGet, "/api/rbac/users/"+userID, userID, nil))
	if getResp.Code != http.StatusOK {
		t.Fatalf("get status = %d, want 200", getResp.Code)
	}

	badUpdate := httptest.NewRecorder()
	h.RBACUpdateUser(badUpdate, requestWithID(http.MethodPut, "/api/rbac/users/"+userID, userID, []byte("{bad json")))
	if badUpdate.Code != http.StatusBadRequest {
		t.Fatalf("bad update status = %d, want 400", badUpdate.Code)
	}

	invalidRoleUpdate := httptest.NewRecorder()
	h.RBACUpdateUser(invalidRoleUpdate, requestWithID(http.MethodPut, "/api/rbac/users/"+userID, userID, mustJSON(t, map[string]string{"role": "owner"})))
	if invalidRoleUpdate.Code != http.StatusBadRequest {
		t.Fatalf("invalid role update status = %d, want 400", invalidRoleUpdate.Code)
	}

	disabled := true
	updateBody := mustJSON(t, map[string]any{"role": "viewer", "disabled": disabled})
	updateResp := httptest.NewRecorder()
	h.RBACUpdateUser(updateResp, requestWithID(http.MethodPut, "/api/rbac/users/"+userID, userID, updateBody))
	if updateResp.Code != http.StatusOK {
		t.Fatalf("update status = %d, want 200: %s", updateResp.Code, updateResp.Body.String())
	}
	updated := decodeBody(t, updateResp)
	if updated["role"] != string(rbac.RoleViewer) || updated["disabled"] != true {
		t.Fatalf("unexpected update response: %#v", updated)
	}

	currentUserReq := httptest.NewRequest(http.MethodGet, "/api/rbac/me", nil)
	currentUserReq = currentUserReq.WithContext(rbac.ContextWithUser(currentUserReq.Context(), &rbac.User{ID: userID, Username: "alice", Role: rbac.RoleViewer}))
	currentUserResp := httptest.NewRecorder()
	h.RBACCurrentUser(currentUserResp, currentUserReq)
	if currentUserResp.Code != http.StatusOK {
		t.Fatalf("current user status = %d, want 200", currentUserResp.Code)
	}

	noUserResp := httptest.NewRecorder()
	h.RBACCurrentUser(noUserResp, httptest.NewRequest(http.MethodGet, "/api/rbac/me", nil))
	if noUserResp.Code != http.StatusUnauthorized {
		t.Fatalf("missing current user status = %d, want 401", noUserResp.Code)
	}

	rolesResp := httptest.NewRecorder()
	h.RBACRoles(rolesResp, httptest.NewRequest(http.MethodGet, "/api/rbac/roles", nil))
	if rolesResp.Code != http.StatusOK {
		t.Fatalf("roles status = %d, want 200", rolesResp.Code)
	}
	var roles []struct {
		Name rbac.Role `json:"name"`
	}
	if err := json.Unmarshal(rolesResp.Body.Bytes(), &roles); err != nil {
		t.Fatalf("decode roles: %v", err)
	}
	if len(roles) != len(rbac.ValidRoles()) {
		t.Fatalf("expected %d roles, got %d", len(rbac.ValidRoles()), len(roles))
	}

	missingDelete := httptest.NewRecorder()
	h.RBACDeleteUser(missingDelete, requestWithID(http.MethodDelete, "/api/rbac/users/missing", "missing", nil))
	if missingDelete.Code != http.StatusNotFound {
		t.Fatalf("missing delete status = %d, want 404", missingDelete.Code)
	}

	deleteResp := httptest.NewRecorder()
	h.RBACDeleteUser(deleteResp, requestWithID(http.MethodDelete, "/api/rbac/users/"+userID, userID, nil))
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", deleteResp.Code)
	}
}

func TestAuditHandlers(t *testing.T) {
	h := newEnterpriseTestHandler(t)
	now := time.Now().UTC()

	entries := []audit.Entry{
		{Timestamp: now.Add(-time.Hour).Format(time.RFC3339Nano), Action: "cluster.create", Method: http.MethodPost, Path: "/api/clusters/", Status: http.StatusCreated, UserID: "u1", Username: "alice"},
		{Timestamp: now.Format(time.RFC3339Nano), Action: "rbac.user.create", Method: http.MethodPost, Path: "/api/rbac/users", Status: http.StatusCreated, UserID: "u2", Username: "bob"},
	}
	for _, entry := range entries {
		if err := h.auditStore.Record(context.Background(), entry); err != nil {
			t.Fatalf("record audit entry: %v", err)
		}
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/audit/?action=cluster.create&user=u1&limit=10&offset=0&since="+now.Add(-2*time.Hour).Format(time.RFC3339), nil)
	listResp := httptest.NewRecorder()
	h.AuditList(listResp, listReq)
	if listResp.Code != http.StatusOK {
		t.Fatalf("audit list status = %d, want 200: %s", listResp.Code, listResp.Body.String())
	}
	listPayload := decodeBody(t, listResp)
	if listPayload["total"] == float64(0) {
		t.Fatalf("expected nonzero total in audit list: %#v", listPayload)
	}
	listEntries, _ := listPayload["entries"].([]any)
	if len(listEntries) != 1 {
		t.Fatalf("expected filtered audit entry, got %#v", listPayload["entries"])
	}

	statsResp := httptest.NewRecorder()
	h.AuditStats(statsResp, httptest.NewRequest(http.MethodGet, "/api/audit/stats", nil))
	if statsResp.Code != http.StatusOK {
		t.Fatalf("audit stats status = %d, want 200: %s", statsResp.Code, statsResp.Body.String())
	}
	stats := decodeBody(t, statsResp)
	if stats["total"] != float64(2) {
		t.Fatalf("expected total 2, got %#v", stats["total"])
	}
}

func TestClusterHandlers(t *testing.T) {
	h := newEnterpriseTestHandler(t)

	invalidBodyResp := httptest.NewRecorder()
	h.ClustersCreate(invalidBodyResp, httptest.NewRequest(http.MethodPost, "/api/clusters/", bytes.NewReader([]byte("{bad json"))))
	if invalidBodyResp.Code != http.StatusBadRequest {
		t.Fatalf("invalid create status = %d, want 400", invalidBodyResp.Code)
	}

	missingFieldsResp := httptest.NewRecorder()
	h.ClustersCreate(missingFieldsResp, httptest.NewRequest(http.MethodPost, "/api/clusters/", bytes.NewReader(mustJSON(t, cluster.ClusterInfo{Name: "prod"}))))
	if missingFieldsResp.Code != http.StatusBadRequest {
		t.Fatalf("missing fields create status = %d, want 400", missingFieldsResp.Code)
	}

	createResp := httptest.NewRecorder()
	createBody := mustJSON(t, cluster.ClusterInfo{Name: "prod", Host: "https://prod.test", Token: "secret-token"})
	h.ClustersCreate(createResp, httptest.NewRequest(http.MethodPost, "/api/clusters/", bytes.NewReader(createBody)))
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201: %s", createResp.Code, createResp.Body.String())
	}
	created := decodeBody(t, createResp)
	clusterID, _ := created["id"].(string)
	if clusterID == "" {
		t.Fatalf("create response missing id: %#v", created)
	}
	if created["token"] != "****oken" {
		t.Fatalf("expected redacted token, got %#v", created["token"])
	}

	listResp := httptest.NewRecorder()
	h.ClustersList(listResp, httptest.NewRequest(http.MethodGet, "/api/clusters/", nil))
	if listResp.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", listResp.Code)
	}
	var clusters []cluster.ClusterInfo
	if err := json.Unmarshal(listResp.Body.Bytes(), &clusters); err != nil {
		t.Fatalf("decode clusters: %v", err)
	}
	if len(clusters) != 1 || clusters[0].ID != clusterID || clusters[0].Token != "****oken" {
		t.Fatalf("unexpected list response: %#v", clusters)
	}

	getResp := httptest.NewRecorder()
	h.ClustersGet(getResp, requestWithID(http.MethodGet, "/api/clusters/"+clusterID, clusterID, nil))
	if getResp.Code != http.StatusOK {
		t.Fatalf("get status = %d, want 200", getResp.Code)
	}

	unknownUpdateResp := httptest.NewRecorder()
	h.ClustersUpdate(unknownUpdateResp, requestWithID(http.MethodPut, "/api/clusters/missing", "missing", mustJSON(t, cluster.ClusterInfo{Name: "missing", Host: "https://missing.test"})))
	if unknownUpdateResp.Code != http.StatusNotFound {
		t.Fatalf("unknown update status = %d, want 404", unknownUpdateResp.Code)
	}

	updateResp := httptest.NewRecorder()
	updateBody := mustJSON(t, cluster.ClusterInfo{Name: "prod-east", Host: "https://prod-east.test", Token: "new-secret"})
	h.ClustersUpdate(updateResp, requestWithID(http.MethodPut, "/api/clusters/"+clusterID, clusterID, updateBody))
	if updateResp.Code != http.StatusOK {
		t.Fatalf("update status = %d, want 200: %s", updateResp.Code, updateResp.Body.String())
	}
	updated := decodeBody(t, updateResp)
	if updated["name"] != "prod-east" || updated["token"] != "****cret" {
		t.Fatalf("unexpected update response: %#v", updated)
	}

	missingTestResp := httptest.NewRecorder()
	h.ClustersTest(missingTestResp, requestWithID(http.MethodPost, "/api/clusters/missing/test", "missing", nil))
	if missingTestResp.Code != http.StatusNotFound {
		t.Fatalf("missing test status = %d, want 404", missingTestResp.Code)
	}

	// Use an invalid host so the connectivity check fails during client setup
	// without attempting a real Kubernetes request.
	if err := h.clusterRegistry.Create(&cluster.ClusterInfo{Name: "broken", Host: "://bad-host", Token: "token"}); err != nil {
		t.Fatalf("seed broken cluster: %v", err)
	}
	var brokenID string
	for _, c := range h.clusterRegistry.List() {
		if c.Name == "broken" {
			brokenID = c.ID
			break
		}
	}
	if brokenID == "" {
		t.Fatal("failed to find broken cluster id")
	}
	testResp := httptest.NewRecorder()
	h.ClustersTest(testResp, requestWithID(http.MethodPost, "/api/clusters/"+brokenID+"/test", brokenID, nil))
	if testResp.Code != http.StatusOK {
		t.Fatalf("connectivity test status = %d, want 200: %s", testResp.Code, testResp.Body.String())
	}
	testPayload := decodeBody(t, testResp)
	if testPayload["ok"] != false {
		t.Fatalf("expected failed connectivity payload, got %#v", testPayload)
	}

	missingDefaultResp := httptest.NewRecorder()
	h.ClustersSetDefault(missingDefaultResp, requestWithID(http.MethodPost, "/api/clusters/missing/default", "missing", nil))
	if missingDefaultResp.Code != http.StatusNotFound {
		t.Fatalf("missing set default status = %d, want 404", missingDefaultResp.Code)
	}

	defaultResp := httptest.NewRecorder()
	h.ClustersSetDefault(defaultResp, requestWithID(http.MethodPost, "/api/clusters/"+clusterID+"/default", clusterID, nil))
	if defaultResp.Code != http.StatusNoContent {
		t.Fatalf("set default status = %d, want 204", defaultResp.Code)
	}

	missingDeleteResp := httptest.NewRecorder()
	h.ClustersDelete(missingDeleteResp, requestWithID(http.MethodDelete, "/api/clusters/missing", "missing", nil))
	if missingDeleteResp.Code != http.StatusNotFound {
		t.Fatalf("missing delete status = %d, want 404", missingDeleteResp.Code)
	}

	deleteResp := httptest.NewRecorder()
	h.ClustersDelete(deleteResp, requestWithID(http.MethodDelete, "/api/clusters/"+clusterID, clusterID, nil))
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", deleteResp.Code)
	}
}
