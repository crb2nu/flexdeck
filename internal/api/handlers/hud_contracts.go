package handlers

import (
	"encoding/json"
	"fmt"
	"strings"
)

func parseHUDEnvelope(raw json.RawMessage) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	if object, ok := decoded.(map[string]any); ok {
		if object["data"] != nil && isHUDWrapperEnvelope(object) {
			switch data := object["data"].(type) {
			case map[string]any:
				return data, nil
			case []any:
				return map[string]any{"items": data}, nil
			}
		}
		return object, nil
	}
	return map[string]any{"items": decoded}, nil
}

func isHUDWrapperEnvelope(object map[string]any) bool {
	if len(object) == 0 || object["data"] == nil {
		return false
	}
	for key := range object {
		switch key {
		case "ok", "data", "meta", "error":
		default:
			return false
		}
	}
	return true
}

func hudItemsFromEnvelope(raw json.RawMessage, key string) ([]map[string]any, error) {
	envelope, err := parseHUDEnvelope(raw)
	if err != nil {
		return nil, err
	}
	var source any
	switch {
	case key != "" && envelope[key] != nil:
		source = envelope[key]
	case envelope["items"] != nil:
		source = envelope["items"]
	default:
		source = envelope
	}
	return hudItemsFromValue(source), nil
}

func hudItemsFromValue(value any) []map[string]any {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	items := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if object, ok := item.(map[string]any); ok {
			items = append(items, object)
		}
	}
	return items
}

func hudString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func hudStringSlice(value any) []string {
	list, ok := value.([]any)
	if !ok {
		if stringsList, ok := value.([]string); ok {
			out := make([]string, 0, len(stringsList))
			for _, item := range stringsList {
				if trimmed := strings.TrimSpace(item); trimmed != "" {
					out = append(out, trimmed)
				}
			}
			return out
		}
		return []string{}
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		if trimmed := hudString(item); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func hudMap(value any) map[string]any {
	object, _ := value.(map[string]any)
	return object
}

func hudInt(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		v, _ := typed.Int64()
		return int(v)
	case string:
		if typed == "" {
			return 0
		}
		var v json.Number = json.Number(strings.TrimSpace(typed))
		parsed, err := v.Int64()
		if err != nil {
			return 0
		}
		return int(parsed)
	default:
		return 0
	}
}

func normalizeHUDWorkflowStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "waiting_approval":
		return "awaiting_approval"
	case "cancelled":
		return "canceled"
	default:
		return status
	}
}

func normalizeHUDTimelineType(eventType string) string {
	switch strings.TrimSpace(eventType) {
	case "agent.session.start", "session.start":
		return "session_start"
	case "agent.session.end", "session.end":
		return "session_end"
	case "agent.heartbeat":
		return "heartbeat"
	case "agent.context.add":
		return "context_add"
	case "agent.task.update", "task.update":
		return "task_update"
	case "agent.claim.add", "agent.claim.release":
		return "file_claim"
	case "hud.approval_needed":
		return "approval_needed"
	case "hud.fleet":
		return "fleet_update"
	case "hud.health":
		return "health_update"
	default:
		return eventType
	}
}

func normalizeHUDPriority(priority string) int {
	switch strings.ToLower(strings.TrimSpace(priority)) {
	case "critical":
		return 4
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

func normalizeHUDSessionsFromValue(value any) []map[string]any {
	items := hudItemsFromValue(value)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"id":           hudString(item["id"]),
			"agentId":      hudString(item["agent_id"]),
			"agentType":    "",
			"namespace":    hudString(item["namespace"]),
			"description":  hudString(item["description"]),
			"startedAt":    hudString(item["started_at"]),
			"contextCount": hudInt(item["entry_count"]),
			"taskCount":    0,
		})
	}
	return out
}

func normalizeHUDPresenceFromValue(value any) []map[string]any {
	items := hudItemsFromValue(value)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"agentId":       hudString(item["agent_id"]),
			"agentType":     hudString(item["agent_type"]),
			"status":        hudString(item["status"]),
			"activeFiles":   hudStringSlice(item["active_files"]),
			"conflicts":     hudStringSlice(item["conflicts"]),
			"lastHeartbeat": hudString(item["last_heartbeat"]),
			"currentTask":   hudString(item["current_task"]),
			"description":   hudString(item["description"]),
			"branch":        hudString(item["branch"]),
			"sessionId":     hudString(item["session_id"]),
		})
	}
	return out
}

func normalizeHUDClaimsFromValue(value any) []map[string]any {
	items := hudItemsFromValue(value)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		expiresAt := hudString(item["expires_at"])
		out = append(out, map[string]any{
			"agentId":   hudString(item["agent_id"]),
			"filePath":  hudString(item["file_path"]),
			"claimType": hudString(item["claim_type"]),
			"reason":    hudString(item["reason"]),
			"createdAt": hudString(item["created_at"]),
			"updatedAt": firstNonEmpty(hudString(item["updated_at"]), expiresAt),
			"expiresAt": expiresAt,
		})
	}
	return out
}

func normalizeHUDTasksFromValue(value any) []map[string]any {
	items := hudItemsFromValue(value)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"id":         hudString(item["id"]),
			"title":      hudString(item["title"]),
			"status":     hudString(item["status"]),
			"priority":   normalizeHUDPriority(hudString(item["priority"])),
			"agentId":    hudString(item["agent_id"]),
			"filePath":   hudString(item["file_path"]),
			"tags":       hudStringSlice(item["tags"]),
			"sessionId":  hudString(item["session_id"]),
			"namespace":  hudString(item["namespace"]),
			"context":    hudString(item["context"]),
			"workflowId": hudString(item["workflow_id"]),
			"project":    hudString(item["project"]),
		})
	}
	return out
}

func summarizeHUDTimelineEntry(item map[string]any, normalizedType string) string {
	data := hudMap(item["data"])
	for _, key := range []string{"summary", "message", "title", "status"} {
		if value := hudString(data[key]); value != "" {
			return value
		}
	}
	if workflowID := hudString(data["workflow_id"]); workflowID != "" {
		if stepID := hudString(data["step_id"]); stepID != "" {
			return fmt.Sprintf("%s (%s)", workflowID, stepID)
		}
		return workflowID
	}
	return strings.ReplaceAll(normalizedType, "_", " ")
}

func normalizeHUDTimelineFromValue(value any) []map[string]any {
	items := hudItemsFromValue(value)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		eventType := normalizeHUDTimelineType(hudString(item["event_type"]))
		out = append(out, map[string]any{
			"timestamp": hudString(item["timestamp"]),
			"type":      eventType,
			"agentId":   hudString(item["agent_id"]),
			"summary":   summarizeHUDTimelineEntry(item, eventType),
			"data":      item["data"],
		})
	}
	return out
}

func normalizeHUDFleetResponse(raw json.RawMessage) (map[string]any, error) {
	envelope, err := parseHUDEnvelope(raw)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"sessions": normalizeHUDSessionsFromValue(envelope["sessions"]),
		"agents":   normalizeHUDPresenceFromValue(envelope["agents"]),
		"claims":   normalizeHUDClaimsFromValue(firstNonNil(envelope["claims"], envelope["file_claims"])),
		"tasks":    normalizeHUDTasksFromValue(envelope["tasks"]),
		"kpis": map[string]any{
			"pending_approvals": hudInt(envelope["pending_approvals"]),
			"running_workflows": hudInt(envelope["running_workflows"]),
			"active_agents":     hudInt(envelope["active_agents"]),
			"idle_agents":       hudInt(envelope["idle_agents"]),
			"offline_agents":    hudInt(envelope["offline_agents"]),
			"total_tasks":       hudInt(envelope["total_tasks"]),
		},
	}, nil
}

func normalizeHUDPresenceResponse(raw json.RawMessage) ([]map[string]any, error) {
	envelope, err := parseHUDEnvelope(raw)
	if err != nil {
		return nil, err
	}
	if envelope["agents"] != nil {
		return normalizeHUDPresenceFromValue(envelope["agents"]), nil
	}
	return normalizeHUDPresenceFromValue(envelope["items"]), nil
}

func normalizeHUDClaimsResponse(raw json.RawMessage) ([]map[string]any, error) {
	envelope, err := parseHUDEnvelope(raw)
	if err != nil {
		return nil, err
	}
	if envelope["claims"] != nil {
		return normalizeHUDClaimsFromValue(envelope["claims"]), nil
	}
	if envelope["file_claims"] != nil {
		return normalizeHUDClaimsFromValue(envelope["file_claims"]), nil
	}
	return normalizeHUDClaimsFromValue(envelope["items"]), nil
}

func normalizeHUDTasksResponse(raw json.RawMessage) ([]map[string]any, error) {
	envelope, err := parseHUDEnvelope(raw)
	if err != nil {
		return nil, err
	}
	if envelope["tasks"] != nil {
		return normalizeHUDTasksFromValue(envelope["tasks"]), nil
	}
	return normalizeHUDTasksFromValue(envelope["items"]), nil
}

func normalizeHUDTimelineResponse(raw json.RawMessage) ([]map[string]any, error) {
	envelope, err := parseHUDEnvelope(raw)
	if err != nil {
		return nil, err
	}
	if eventType := firstNonEmpty(hudString(envelope["type"]), hudString(envelope["event_type"])); eventType != "" {
		return normalizeHUDSSEEnvelope(envelope), nil
	}
	if envelope["event_type"] != nil {
		return normalizeHUDTimelineFromValue([]any{envelope}), nil
	}
	if envelope["entries"] != nil {
		return normalizeHUDTimelineFromValue(envelope["entries"]), nil
	}
	if envelope["recent_timeline"] != nil {
		return normalizeHUDTimelineFromValue(envelope["recent_timeline"]), nil
	}
	return normalizeHUDTimelineFromValue(envelope["items"]), nil
}

func normalizeHUDSSEDataLine(line string) string {
	if !strings.HasPrefix(line, "data:") {
		return line
	}
	payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
	if payload == "" {
		return line
	}
	envelope, err := parseHUDEnvelope(json.RawMessage(payload))
	if err != nil {
		return line
	}
	events := normalizeHUDSSEEnvelope(envelope)
	if len(events) == 0 {
		return line
	}
	normalized, err := json.Marshal(events[0])
	if err != nil {
		return line
	}
	return "data: " + string(normalized)
}

func normalizeHUDSSEEnvelope(envelope map[string]any) []map[string]any {
	if eventType := firstNonEmpty(hudString(envelope["type"]), hudString(envelope["event_type"])); eventType != "" {
		data := hudMap(envelope["data"])
		normalizedType := normalizeHUDTimelineType(eventType)
		summary := summarizeHUDTimelineEntry(map[string]any{"data": data}, normalizedType)
		if summary == strings.ReplaceAll(normalizedType, "_", " ") {
			switch normalizedType {
			case "fleet_update":
				summary = "Fleet snapshot refreshed"
			case "health_update":
				summary = "Health snapshot refreshed"
			case "approval_needed":
				summary = "Approval required"
			}
		}
		return []map[string]any{
			{
				"timestamp": firstNonEmpty(hudString(envelope["timestamp"]), hudString(data["timestamp"])),
				"type":      normalizedType,
				"agentId": firstNonEmpty(
					hudString(envelope["agent_id"]),
					hudString(envelope["agentId"]),
					hudString(data["agent_id"]),
					hudString(data["agentId"]),
				),
				"summary": summary,
				"data":    data,
			},
		}
	}
	if envelope["event_type"] != nil {
		return normalizeHUDTimelineFromValue([]any{envelope})
	}
	if envelope["entries"] != nil {
		return normalizeHUDTimelineFromValue(envelope["entries"])
	}
	if envelope["recent_timeline"] != nil {
		return normalizeHUDTimelineFromValue(envelope["recent_timeline"])
	}
	if envelope["items"] != nil {
		return normalizeHUDTimelineFromValue(envelope["items"])
	}
	return nil
}

func workflowCurrentStepIndex(currentStep string, steps []map[string]any) int {
	if len(steps) == 0 {
		return 0
	}
	for i, step := range steps {
		if hudString(step["id"]) == currentStep || hudString(step["name"]) == currentStep {
			return i
		}
	}
	return 0
}

func normalizeHUDWorkflowStep(step map[string]any) map[string]any {
	stepType := hudString(step["type"])
	status := normalizeHUDWorkflowStatus(hudString(step["status"]))
	return map[string]any{
		"id":               hudString(step["id"]),
		"name":             hudString(step["name"]),
		"status":           status,
		"type":             stepType,
		"requiresApproval": stepType == "approval" || status == "awaiting_approval",
	}
}

func synthesizeHUDWorkflowStep(summary map[string]any, detail map[string]any) map[string]any {
	stepID := firstNonEmpty(
		hudString(detail["current_step"]),
		hudString(summary["current_step"]),
		hudString(summary["name"]),
		hudString(summary["id"]),
	)
	status := normalizeHUDWorkflowStatus(firstNonEmpty(hudString(detail["status"]), hudString(summary["status"])))
	stepType := "tool"
	if status == "awaiting_approval" {
		stepType = "approval"
	}
	return normalizeHUDWorkflowStep(map[string]any{
		"id":     stepID,
		"name":   stepID,
		"status": status,
		"type":   stepType,
	})
}

func normalizeHUDWorkflowSummary(summary map[string]any, detail map[string]any) map[string]any {
	name := firstNonEmpty(hudString(summary["name"]), hudString(detail["name"]), hudString(summary["definition_id"]), hudString(detail["definition_id"]))
	id := firstNonEmpty(hudString(summary["id"]), hudString(summary["workflow_id"]), hudString(detail["id"]), hudString(detail["workflow_id"]))
	currentStepID := firstNonEmpty(hudString(summary["current_step"]), hudString(detail["current_step"]))
	rawSteps := hudItemsFromValue(detail["steps"])
	steps := make([]map[string]any, 0, len(rawSteps))
	for _, step := range rawSteps {
		steps = append(steps, normalizeHUDWorkflowStep(step))
	}
	if len(steps) == 0 {
		steps = append(steps, synthesizeHUDWorkflowStep(summary, detail))
	}
	currentStep := workflowCurrentStepIndex(currentStepID, steps)
	startedAt := firstNonEmpty(hudString(detail["started_at"]), hudString(detail["created_at"]), hudString(summary["started_at"]), hudString(summary["created_at"]))
	return map[string]any{
		"id":           id,
		"definitionId": firstNonEmpty(name, id),
		"status":       normalizeHUDWorkflowStatus(firstNonEmpty(hudString(detail["status"]), hudString(summary["status"]))),
		"currentStep":  currentStep,
		"steps":        steps,
		"startedAt":    startedAt,
	}
}

func normalizeHUDWorkflowsResponse(raw json.RawMessage) ([]map[string]any, error) {
	envelope, err := parseHUDEnvelope(raw)
	if err != nil {
		return nil, err
	}
	source := envelope["workflows"]
	if source == nil {
		source = envelope["items"]
	}
	items := hudItemsFromValue(source)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, normalizeHUDWorkflowSummary(item, nil))
	}
	return out, nil
}

func resolveHUDWorkflowStepID(detail map[string]any) string {
	root := detail
	if workflow := hudMap(detail["workflow"]); len(workflow) > 0 {
		root = workflow
	}
	if stepID := hudString(root["current_step"]); stepID != "" {
		return stepID
	}
	steps := hudItemsFromValue(root["steps"])
	if len(steps) == 0 {
		return ""
	}
	return hudString(steps[0]["id"])
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
