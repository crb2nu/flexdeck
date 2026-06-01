// Alertmanager (Step 4)
export interface AlertmanagerAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  endsAt: string;
  fingerprint: string;
  status: { state: "active" | "suppressed" | "unprocessed"; silencedBy: string[]; inhibitedBy: string[] };
}

export interface AlertmanagerSilence {
  id: string;
  matchers: Array<{ name: string; value: string; isRegex: boolean; isEqual: boolean }>;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  comment: string;
  status: { state: "active" | "pending" | "expired" };
}
