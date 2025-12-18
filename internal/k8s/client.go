package k8s

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/flexinfer/flexdeck/internal/config"
)

type Client struct {
	clientset  *kubernetes.Clientset
	restConfig *rest.Config
	config     config.K8sConfig
}

func NewClient(cfg config.K8sConfig) (*Client, error) {
	var restConfig *rest.Config
	var err error

	if cfg.Token != "" {
		restConfig = &rest.Config{
			Host:        cfg.Host,
			BearerToken: cfg.Token,
			TLSClientConfig: rest.TLSClientConfig{
				Insecure: cfg.SkipTLSVerify,
				CAFile:   cfg.CAFile,
			},
		}
	} else {
		restConfig, err = rest.InClusterConfig()
		if err != nil {
			restConfig, err = clientcmd.BuildConfigFromFlags("", clientcmd.RecommendedHomeFile)
			if err != nil {
				return nil, fmt.Errorf("failed to build k8s config: %w", err)
			}
		}
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create k8s clientset: %w", err)
	}

	return &Client{
		clientset:  clientset,
		restConfig: restConfig,
		config:     cfg,
	}, nil
}

func (c *Client) GetServices(ctx context.Context, namespace string) (*corev1.ServiceList, error) {
	if namespace == "" {
		return c.clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	}
	return c.clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
}

func (c *Client) GetNodes(ctx context.Context) (*corev1.NodeList, error) {
	return c.clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
}

func (c *Client) GetDeployments(ctx context.Context, namespace string) (*appsv1.DeploymentList, error) {
	if namespace == "" {
		return c.clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	}
	return c.clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
}

func (c *Client) GetDeployment(ctx context.Context, namespace, name string) (*appsv1.Deployment, error) {
	return c.clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
}

func (c *Client) GetPods(ctx context.Context, namespace string) (*corev1.PodList, error) {
	if namespace == "" {
		return c.clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	}
	return c.clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
}

func (c *Client) GetIngresses(ctx context.Context, namespace string) (*networkingv1.IngressList, error) {
	if namespace == "" {
		return c.clientset.NetworkingV1().Ingresses("").List(ctx, metav1.ListOptions{})
	}
	return c.clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
}

func (c *Client) ScaleDeployment(ctx context.Context, namespace, name string, replicas int32) error {
	scale, err := c.clientset.AppsV1().Deployments(namespace).GetScale(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get scale: %w", err)
	}

	scale.Spec.Replicas = replicas

	_, err = c.clientset.AppsV1().Deployments(namespace).UpdateScale(ctx, name, scale, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update scale: %w", err)
	}

	return nil
}

func (c *Client) RestartDeployment(ctx context.Context, namespace, name string) error {
	deployment, err := c.clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment: %w", err)
	}

	if deployment.Spec.Template.Annotations == nil {
		deployment.Spec.Template.Annotations = make(map[string]string)
	}
	deployment.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = metav1.Now().Format("2006-01-02T15:04:05Z")

	_, err = c.clientset.AppsV1().Deployments(namespace).Update(ctx, deployment, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to restart deployment: %w", err)
	}

	return nil
}

func (c *Client) Clientset() *kubernetes.Clientset {
	return c.clientset
}

func (c *Client) Config() *rest.Config {
	return c.restConfig
}

// WatchEvent represents a Kubernetes watch event
type WatchEvent struct {
	Type       string      `json:"type"`
	ObjectType string      `json:"objectType"`
	Object     interface{} `json:"object"`
}

// WatchNodes returns a channel of watch events for nodes
func (c *Client) WatchNodes(ctx context.Context) (<-chan WatchEvent, error) {
	watcher, err := c.clientset.CoreV1().Nodes().Watch(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to watch nodes: %w", err)
	}

	events := make(chan WatchEvent, 100)

	go func() {
		defer close(events)
		defer watcher.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.ResultChan():
				if !ok {
					return
				}
				events <- WatchEvent{
					Type:       string(event.Type),
					ObjectType: "node",
					Object:     event.Object,
				}
			}
		}
	}()

	return events, nil
}

// WatchPods returns a channel of watch events for pods
func (c *Client) WatchPods(ctx context.Context, namespace string) (<-chan WatchEvent, error) {
	opts := metav1.ListOptions{}
	var watcher watch.Interface
	var err error

	if namespace == "" {
		watcher, err = c.clientset.CoreV1().Pods("").Watch(ctx, opts)
	} else {
		watcher, err = c.clientset.CoreV1().Pods(namespace).Watch(ctx, opts)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to watch pods: %w", err)
	}

	events := make(chan WatchEvent, 100)

	go func() {
		defer close(events)
		defer watcher.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.ResultChan():
				if !ok {
					return
				}
				events <- WatchEvent{
					Type:       string(event.Type),
					ObjectType: "pod",
					Object:     event.Object,
				}
			}
		}
	}()

	return events, nil
}

// WatchServices returns a channel of watch events for services
func (c *Client) WatchServices(ctx context.Context, namespace string) (<-chan WatchEvent, error) {
	opts := metav1.ListOptions{}
	var watcher watch.Interface
	var err error

	if namespace == "" {
		watcher, err = c.clientset.CoreV1().Services("").Watch(ctx, opts)
	} else {
		watcher, err = c.clientset.CoreV1().Services(namespace).Watch(ctx, opts)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to watch services: %w", err)
	}

	events := make(chan WatchEvent, 100)

	go func() {
		defer close(events)
		defer watcher.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.ResultChan():
				if !ok {
					return
				}
				events <- WatchEvent{
					Type:       string(event.Type),
					ObjectType: "service",
					Object:     event.Object,
				}
			}
		}
	}()

	return events, nil
}
