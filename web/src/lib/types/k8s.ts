// K8s types (simplified from full K8s API types)
export interface K8sMetadata {
  name: string;
  namespace?: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
}

export interface K8sCondition {
  type: string;
  status: "True" | "False" | "Unknown";
  lastTransitionTime?: string;
  reason?: string;
  message?: string;
}

export interface K8sNode {
  metadata: K8sMetadata;
  status: {
    conditions: K8sCondition[];
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
  };
}

export interface K8sPod {
  metadata: K8sMetadata;
  spec: {
    nodeName?: string;
    containers: Array<{
      name: string;
      image: string;
    }>;
  };
  status: {
    phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";
    conditions?: K8sCondition[];
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
    }>;
  };
}

export interface K8sService {
  metadata: K8sMetadata;
  spec: {
    type: "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName";
    clusterIP?: string;
    ports?: Array<{
      name?: string;
      port: number;
      targetPort: number | string;
      protocol: string;
    }>;
    selector?: Record<string, string>;
  };
  status?: {
    loadBalancer?: {
      ingress?: Array<{ ip?: string; hostname?: string }>;
    };
  };
}

export interface K8sDeployment {
  metadata: K8sMetadata;
  spec: {
    replicas: number;
    selector: {
      matchLabels: Record<string, string>;
    };
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
        }>;
      };
    };
  };
  status: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    updatedReplicas?: number;
  };
}

export interface K8sIngress {
  metadata: K8sMetadata;
  spec: {
    ingressClassName?: string;
    tls?: Array<{
      hosts: string[];
      secretName: string;
    }>;
    rules?: Array<{
      host?: string;
      http?: {
        paths: Array<{
          path: string;
          pathType: string;
          backend: {
            service: {
              name: string;
              port: { number?: number; name?: string };
            };
          };
        }>;
      };
    }>;
  };
}

export interface K8sList<T> {
  items: T[];
  metadata?: {
    continue?: string;
    resourceVersion?: string;
  };
}

// StatefulSet type
export interface K8sStatefulSet {
  metadata: K8sMetadata;
  spec: {
    replicas: number;
    serviceName: string;
    selector: {
      matchLabels: Record<string, string>;
    };
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
        }>;
      };
    };
    volumeClaimTemplates?: Array<{
      metadata: { name: string };
      spec: {
        accessModes: string[];
        resources: { requests: { storage: string } };
      };
    }>;
  };
  status: {
    replicas?: number;
    readyReplicas?: number;
    currentReplicas?: number;
    updatedReplicas?: number;
    currentRevision?: string;
    updateRevision?: string;
  };
}

// DaemonSet type
export interface K8sDaemonSet {
  metadata: K8sMetadata;
  spec: {
    selector: {
      matchLabels: Record<string, string>;
    };
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
        }>;
      };
    };
    updateStrategy?: {
      type: "RollingUpdate" | "OnDelete";
      rollingUpdate?: {
        maxUnavailable?: number | string;
      };
    };
  };
  status: {
    currentNumberScheduled: number;
    desiredNumberScheduled: number;
    numberReady: number;
    numberAvailable?: number;
    numberMisscheduled?: number;
    updatedNumberScheduled?: number;
  };
}

// Job type
export interface K8sJob {
  metadata: K8sMetadata;
  spec: {
    parallelism?: number;
    completions?: number;
    backoffLimit?: number;
    activeDeadlineSeconds?: number;
    ttlSecondsAfterFinished?: number;
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
        }>;
        restartPolicy: "Never" | "OnFailure";
      };
    };
  };
  status: {
    conditions?: K8sCondition[];
    startTime?: string;
    completionTime?: string;
    active?: number;
    succeeded?: number;
    failed?: number;
  };
}

// CronJob type
export interface K8sCronJob {
  metadata: K8sMetadata;
  spec: {
    schedule: string;
    concurrencyPolicy?: "Allow" | "Forbid" | "Replace";
    suspend?: boolean;
    successfulJobsHistoryLimit?: number;
    failedJobsHistoryLimit?: number;
    jobTemplate: {
      spec: K8sJob["spec"];
    };
  };
  status: {
    active?: Array<{ name: string; namespace: string }>;
    lastScheduleTime?: string;
    lastSuccessfulTime?: string;
  };
}
