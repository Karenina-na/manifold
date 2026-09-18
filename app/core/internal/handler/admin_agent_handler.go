package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	agentconversation "github.com/manifold-space/manifold/app/core/internal/agent/conversation"
	"github.com/manifold-space/manifold/app/core/internal/agent/provider/openai"
	agentruntime "github.com/manifold-space/manifold/app/core/internal/agent/runtime"
	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/auth"
)

type agentRunInput struct {
	Message string `json:"message" validate:"required,max=4000"`
}

type agentMessageView struct {
	ID        string                          `json:"id"`
	Role      string                          `json:"role"`
	Content   string                          `json:"content"`
	CreatedAt string                          `json:"createdAt"`
	Trace     *agentconversation.MessageTrace `json:"trace,omitempty"`
}

type agentCompactionView struct {
	Summary           string `json:"summary"`
	CompactedMessages int    `json:"compactedMessages"`
	RecentTurns       int    `json:"recentTurns"`
	AfterMessageID    string `json:"afterMessageId,omitempty"`
}

func agentCompactionStateView(state agentconversation.Summary, messages []agentconversation.Message) *agentCompactionView {
	if state.Content == "" {
		return nil
	}
	anchorSequence := state.AnchorSequence
	if anchorSequence == 0 {
		anchorSequence = state.ThroughSequence
	}
	return &agentCompactionView{Summary: state.Content, CompactedMessages: state.CompactedMessages, RecentTurns: state.RecentTurns, AfterMessageID: compactionMessageID(messages, anchorSequence)}
}

func compactionMessageID(messages []agentconversation.Message, sequence uint64) string {
	if sequence == 0 {
		return ""
	}
	for _, message := range messages {
		if message.Sequence == sequence {
			return message.ID
		}
	}
	return ""
}

func agentMessageViews(messages []agentconversation.Message) []agentMessageView {
	views := make([]agentMessageView, 0, len(messages))
	for _, message := range messages {
		views = append(views, agentMessageView{ID: message.ID, Role: message.Role, Content: message.Content, CreatedAt: message.CreatedAt.UTC().Format(time.RFC3339), Trace: message.Trace})
	}
	return views
}

func (h *apiHandler) adminAgentMessages(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || h.agentRuntime == nil {
		WriteError(w, http.StatusServiceUnavailable, apierror.AgentUnavailable, "Agent conversation is unavailable.")
		return
	}
	snapshot, err := h.agentRuntime.Snapshot(r.Context(), claims.ID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.AgentRunFailed, "Agent messages could not be loaded.")
		return
	}
	response := map[string]any{"messages": agentMessageViews(snapshot.Messages)}
	if compaction := agentCompactionStateView(snapshot.Summary, snapshot.Messages); compaction != nil {
		response["compaction"] = compaction
	}
	WriteJSON(w, http.StatusOK, response)
}

func (h *apiHandler) adminClearAgentMessages(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || h.agentRuntime == nil {
		WriteError(w, http.StatusServiceUnavailable, apierror.AgentUnavailable, "Agent conversation is unavailable.")
		return
	}
	if err := h.agentRuntime.Clear(r.Context(), claims.ID); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.AgentRunFailed, "Agent messages could not be cleared.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminCompactAgentMessages(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || h.agentRuntime == nil {
		WriteError(w, http.StatusServiceUnavailable, apierror.AgentUnavailable, "The agent provider is not configured.")
		return
	}
	result, err := h.agentRuntime.Compact(r.Context(), claims.ID)
	if err != nil {
		if errors.Is(err, errAgentUnavailable) {
			WriteError(w, http.StatusServiceUnavailable, apierror.AgentUnavailable, "The agent provider is not configured.")
			return
		}
		WriteError(w, http.StatusInternalServerError, apierror.AgentRunFailed, "Agent messages could not be compacted.")
		return
	}
	response := map[string]any{"compacted": result.Compacted, "compaction": agentCompactionView{Summary: result.State.Summary, CompactedMessages: result.State.CompactedMessages, RecentTurns: result.State.RecentTurns, AfterMessageID: result.State.AfterMessageID}}
	WriteJSON(w, http.StatusOK, response)
}

func (h *apiHandler) adminUndoAgentMessage(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || h.agentRuntime == nil {
		WriteError(w, http.StatusServiceUnavailable, apierror.AgentUnavailable, "Agent conversation is unavailable.")
		return
	}
	restored, messages, err := h.agentRuntime.Undo(r.Context(), claims.ID, chi.URLParam(r, "id"))
	if errors.Is(err, agentconversation.ErrMessageNotFound) || errors.Is(err, agentconversation.ErrMessageNotUser) {
		WriteError(w, http.StatusNotFound, apierror.AgentMessageNotFound, "The user message is no longer available to undo.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.AgentRunFailed, "The conversation could not be reorganized.")
		return
	}
	response := map[string]any{"draft": restored.Content, "messages": agentMessageViews(messages)}
	if snapshot, snapshotErr := h.agentRuntime.Snapshot(r.Context(), claims.ID); snapshotErr == nil {
		if compaction := agentCompactionStateView(snapshot.Summary, snapshot.Messages); compaction != nil {
			response["compaction"] = compaction
		}
	} else {
		WriteError(w, http.StatusInternalServerError, apierror.AgentRunFailed, "The conversation could not be reorganized.")
		return
	}
	WriteJSON(w, http.StatusOK, response)
}

func (h *apiHandler) adminRunAgent(w http.ResponseWriter, r *http.Request) {
	var input agentRunInput
	if err := decodeJSON(w, r, &input); err != nil || h.validate.Struct(input) != nil || strings.TrimSpace(input.Message) == "" {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "message is required and must not exceed 4000 characters.")
		}
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || h.agentRuntime == nil || h.agentRuntime.Ready(r.Context()) != nil {
		WriteError(w, http.StatusServiceUnavailable, apierror.AgentUnavailable, "The agent provider is not configured.")
		return
	}
	flusher, ok := responseFlusher(w)
	if !ok {
		WriteError(w, http.StatusInternalServerError, apierror.AgentRunFailed, "Streaming is unavailable.")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	runID := ""
	emit := func(event agentruntime.StreamEvent) error {
		if event.Type == agentruntime.EventRunStarted {
			runID = event.RunID
		}
		payload, err := json.Marshal(event)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, payload); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}
	if err := h.agentRuntime.Run(r.Context(), claims.ID, strings.TrimSpace(input.Message), emit); err != nil {
		if r.Context().Err() != nil {
			return
		}
		var upstream *openai.UpstreamError
		if errors.As(err, &upstream) {
			slog.Error("agent_run_failed", "status", upstream.StatusCode, "code", upstream.Code, "sessionId", claims.ID)
		} else {
			slog.Error("agent_run_failed", "errorType", fmt.Sprintf("%T", err), "sessionId", claims.ID)
		}
		_ = emit(agentruntime.StreamEvent{Type: agentruntime.EventRunError, RunID: runID, Code: apierror.AgentRunFailed, Message: agentRunErrorMessage(err)})
	}
}

func agentRunErrorMessage(err error) string {
	var upstream *openai.UpstreamError
	if !errors.As(err, &upstream) {
		return "The agent could not complete this request. Check the Core logs and provider settings."
	}
	message := strings.ToLower(upstream.Message)
	switch {
	case upstream.StatusCode == http.StatusTooManyRequests || strings.Contains(message, "rate limit") || strings.Contains(message, "rate-limited") || strings.Contains(message, "overloaded"):
		return "The provider is rate limited or overloaded. Retry shortly or choose another model."
	case upstream.Code == "model_not_found" || strings.Contains(message, "no available channel") || strings.Contains(message, "model not found"):
		return "The configured model is unavailable at the provider. Choose a model returned by the provider."
	case strings.Contains(message, "context length") || strings.Contains(message, "maximum context") || strings.Contains(message, "max output"):
		return "The configured output limit exceeds the provider context window. Lower max output tokens."
	default:
		return "The provider rejected the request. Check the Agent model and runtime settings."
	}
}

func responseFlusher(w http.ResponseWriter) (http.Flusher, bool) {
	for {
		if flusher, ok := w.(http.Flusher); ok {
			return flusher, true
		}
		unwrapper, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return nil, false
		}
		w = unwrapper.Unwrap()
	}
}
