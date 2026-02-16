package cluster

import (
	"context"
	"net/http"
)

// ClusterHeader is the HTTP header used to select a cluster.
const ClusterHeader = "X-Cluster-ID"

type clusterContextKey struct{}

// ClusterIDFromRequest reads the cluster ID from the request header or query param.
func ClusterIDFromRequest(r *http.Request) string {
	if id := r.Header.Get(ClusterHeader); id != "" {
		return id
	}
	return r.URL.Query().Get("cluster")
}

// ContextWithClusterID stores the cluster ID in the context.
func ContextWithClusterID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, clusterContextKey{}, id)
}

// ClusterIDFromContext retrieves the cluster ID from the context.
func ClusterIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(clusterContextKey{}).(string)
	return id
}
