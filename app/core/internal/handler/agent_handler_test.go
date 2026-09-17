package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-playground/validator/v10"
	"golang.org/x/crypto/bcrypt"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	"github.com/manifold-space/manifold/app/core/internal/agent/repository"
	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/events"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type fakeAgentRunner struct {
	memory    *repository.Memory
	beforeRun func()
	runError  error
}

func (fakeAgentRunner) Ready(context.Context) error { return nil }
func (runner fakeAgentRunner) List(ctx context.Context, sessionID string, limit int) ([]repository.Message, error) {
	return runner.memory.List(ctx, sessionID, limit)
}
func (runner fakeAgentRunner) Clear(ctx context.Context, sessionID string) error {
	return runner.memory.Delete(ctx, sessionID)
}
func (runner fakeAgentRunner) Run(_ context.Context, _ string, _ string, emit func(agent.StreamEvent) error) error {
	if runner.beforeRun != nil {
		runner.beforeRun()
	}
	if runner.runError != nil {
		return runner.runError
	}
	usage := agent.Usage{InputTokens: 2, OutputTokens: 1, TotalTokens: 3}
	for _, event := range []agent.StreamEvent{{Type: agent.EventRunStarted, RunID: "run_1", MessageID: "msg_1"}, {Type: agent.EventContentDelta, Delta: "Hello"}, {Type: agent.EventRunCompleted, RunID: "run_1", FinishReason: agent.FinishStop, Usage: &usage}} {
		if err := emit(event); err != nil {
			return err
		}
	}
	return nil
}
func (runner fakeAgentRunner) Undo(ctx context.Context, sessionID, messageID string) (repository.Message, []repository.Message, error) {
	return runner.memory.UndoTurn(ctx, sessionID, messageID)
}

func newAgentHTTPTest(t *testing.T) (http.Handler, string, *repository.Memory) {
	return newAgentHTTPTestWithRunner(t, nil)
}

func newAgentHTTPTestWithRunner(t *testing.T, configure func(*fakeAgentRunner)) (http.Handler, string, *repository.Memory) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	database, err := store.Open(t.Context(), ":memory:", store.WithAdminCredential("admin", string(hash)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	cfg := config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash), AllowedOrigins: []string{"*"}}
	authService, err := auth.New(cfg, database)
	if err != nil {
		t.Fatal(err)
	}
	token, err := authService.Login(t.Context(), "admin", "password")
	if err != nil {
		t.Fatal(err)
	}
	memory := repository.NewMemory()
	runner := fakeAgentRunner{memory: memory}
	if configure != nil {
		configure(&runner)
	}
	h := &apiHandler{cfg: cfg, store: database, auth: authService, validate: validator.New(), auditEvents: events.NewSynchronousAuditPublisher(recordAuditEvent(database)), agentRuntime: runner}
	return buildRouter(h, cfg), token, memory
}

func TestAdminAgentSettingsArePersistentAndAPIKeyIsWriteOnly(t *testing.T) {
	router, token, _ := newAgentHTTPTest(t)

	get := httptest.NewRecorder()
	getRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/agent/settings", nil)
	getRequest.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(get, getRequest)
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), `"model":"gpt-5-mini"`) || !strings.Contains(get.Body.String(), `"apiKeyConfigured":false`) {
		t.Fatalf("unexpected default settings: %d %s", get.Code, get.Body.String())
	}

	update := httptest.NewRecorder()
	updateRequest := httptest.NewRequest(http.MethodPut, "/api/v1/admin/agent/settings", strings.NewReader(`{"provider":"openai","model":"gpt-5","maxToolRounds":4,"historyLimit":24,"maxOutputTokens":4096,"openAIBaseURL":"https://example.test/v1/","apiKey":"secret-value"}`))
	updateRequest.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(update, updateRequest)
	if update.Code != http.StatusOK || !strings.Contains(update.Body.String(), `"apiKeyConfigured":true`) || strings.Contains(update.Body.String(), "secret-value") {
		t.Fatalf("unexpected updated settings: %d %s", update.Code, update.Body.String())
	}
	if !strings.Contains(update.Body.String(), `"openAIBaseURL":"https://example.test/v1"`) {
		t.Fatalf("base URL was not normalized: %s", update.Body.String())
	}
	audit := httptest.NewRecorder()
	auditRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/audit?q=agent.settings.updated", nil)
	auditRequest.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(audit, auditRequest)
	if audit.Code != http.StatusOK || !strings.Contains(audit.Body.String(), `agent.settings.updated`) || !strings.Contains(audit.Body.String(), `apiKeyConfigured`) || strings.Contains(audit.Body.String(), "secret-value") {
		t.Fatalf("agent settings audit leaked or omitted security metadata: %d %s", audit.Code, audit.Body.String())
	}
}

func TestAdminAgentSettingsCanKeepOrClearAPIKey(t *testing.T) {
	router, token, _ := newAgentHTTPTest(t)
	put := func(body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPut, "/api/v1/admin/agent/settings", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		router.ServeHTTP(recorder, request)
		return recorder
	}
	base := `{"provider":"openai","model":"gpt-5-mini","maxToolRounds":6,"historyLimit":40,"maxOutputTokens":2048,"openAIBaseURL":"https://api.openai.com/v1"`
	if response := put(base + `,"apiKey":"secret-value"}`); response.Code != http.StatusOK {
		t.Fatalf("configure key: %d %s", response.Code, response.Body.String())
	}
	if response := put(base + `}`); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"apiKeyConfigured":true`) {
		t.Fatalf("keep key: %d %s", response.Code, response.Body.String())
	}
	if response := put(base + `,"apiKey":null}`); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"apiKeyConfigured":false`) {
		t.Fatalf("clear key: %d %s", response.Code, response.Body.String())
	}
}

func TestAdminAgentSettingsNormalizesOpenAIBaseURL(t *testing.T) {
	router, token, _ := newAgentHTTPTest(t)
	for _, test := range []struct {
		body string
		want string
	}{
		{
			body: `{"provider":"openai","model":"gpt-5-mini","maxToolRounds":6,"historyLimit":40,"maxOutputTokens":2048,"openAIBaseURL":" https://example.test "}`,
			want: `"openAIBaseURL":"https://example.test/v1"`,
		},
		{
			body: `{"provider":"openai","model":"gpt-5-mini","maxToolRounds":6,"historyLimit":40,"maxOutputTokens":2048,"openAIBaseURL":"https://example.test/v1/"}`,
			want: `"openAIBaseURL":"https://example.test/v1"`,
		},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPut, "/api/v1/admin/agent/settings", strings.NewReader(test.body))
		request.Header.Set("Authorization", "Bearer "+token)
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), test.want) {
			t.Fatalf("unexpected normalized settings: %d %s", recorder.Code, recorder.Body.String())
		}
	}
}

func TestAdminAgentSettingsRejectInvalidLimitsAndURLs(t *testing.T) {
	router, token, _ := newAgentHTTPTest(t)
	for _, body := range []string{
		`{"provider":"openai","model":"gpt-5-mini","maxToolRounds":13,"historyLimit":40,"maxOutputTokens":2048,"openAIBaseURL":"https://api.openai.com/v1"}`,
		`{"provider":"openai","model":"gpt-5-mini","maxToolRounds":6,"historyLimit":40,"maxOutputTokens":2048,"openAIBaseURL":"https://user@example.test/v1"}`,
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPut, "/api/v1/admin/agent/settings", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusUnprocessableEntity {
			t.Fatalf("expected validation failure, got %d %s", recorder.Code, recorder.Body.String())
		}
	}
}

func TestAdminAgentStreamsUnifiedEvents(t *testing.T) {
	router, token, _ := newAgentHTTPTest(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/agent/messages", strings.NewReader(`{"message":"Hello"}`))
	request.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatalf("unexpected response: %d %v", recorder.Code, recorder.Header())
	}
	body := recorder.Body.String()
	for _, event := range []string{"event: run.started", "event: content.delta", "event: run.completed"} {
		if !strings.Contains(body, event) {
			t.Fatalf("missing %q in %s", event, body)
		}
	}
}

func TestAdminAgentDoesNotEmitAnErrorAfterTheClientCancels(t *testing.T) {
	var cancel context.CancelFunc
	router, token, _ := newAgentHTTPTestWithRunner(t, func(runner *fakeAgentRunner) {
		runner.beforeRun = func() { cancel() }
		runner.runError = context.Canceled
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/agent/messages", strings.NewReader(`{"message":"Hello"}`))
	request.Header.Set("Authorization", "Bearer "+token)
	ctx, stop := context.WithCancel(request.Context())
	cancel = stop
	request = request.WithContext(ctx)

	router.ServeHTTP(recorder, request)

	if strings.Contains(recorder.Body.String(), "run.error") {
		t.Fatalf("client cancellation emitted a stream error: %s", recorder.Body.String())
	}
}

func TestAdminAgentMessageHistoryIsSessionScopedAndClearable(t *testing.T) {
	router, token, memory := newAgentHTTPTest(t)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatal("invalid token")
	}
	// The authenticated endpoint itself supplies the authoritative session id;
	// seed through the stream route's known token by decoding only in the test.
	var payload struct {
		ID string `json:"jti"`
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(decoded, &payload) != nil {
		t.Fatal("decode test token")
	}
	_, _ = memory.Append(t.Context(), payload.ID, repository.Message{
		Role:    "assistant",
		Content: "Remembered",
		Trace: &repository.MessageTrace{
			Steps:        []repository.TraceStep{{ID: "reasoning-1", Kind: "reasoning", Status: "complete"}},
			FinishReason: "stop",
			Usage:        repository.TraceUsage{InputTokens: 2, OutputTokens: 1, TotalTokens: 3},
		},
	})

	get := httptest.NewRecorder()
	getRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/agent/messages", nil)
	getRequest.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(get, getRequest)
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), "Remembered") || !strings.Contains(get.Body.String(), `"trace":{"steps":[{"id":"reasoning-1","kind":"reasoning","status":"complete"}],"finishReason":"stop","usage":{"inputTokens":2,"outputTokens":1,"totalTokens":3}}`) {
		t.Fatalf("unexpected history: %d %s", get.Code, get.Body.String())
	}

	clear := httptest.NewRecorder()
	clearRequest := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/agent/messages", nil)
	clearRequest.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(clear, clearRequest)
	if clear.Code != http.StatusNoContent {
		t.Fatalf("unexpected clear status: %d", clear.Code)
	}
	messages, _ := memory.List(t.Context(), payload.ID, 20)
	if len(messages) != 0 {
		t.Fatalf("memory was not cleared: %+v", messages)
	}
}

func TestAdminAgentUndoReturnsDraftAndReorganizedHistory(t *testing.T) {
	router, token, memory := newAgentHTTPTest(t)
	parts := strings.Split(token, ".")
	var payload struct {
		ID string `json:"jti"`
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(decoded, &payload) != nil {
		t.Fatal("decode test token")
	}
	for _, message := range []repository.Message{
		{ID: "user-1", Role: "user", Content: "Earlier"},
		{ID: "assistant-1", Role: "assistant", Content: "Earlier answer"},
		{ID: "user-2", Role: "user", Content: "Revise this"},
		{ID: "assistant-2", Role: "assistant", Content: "Latest answer"},
	} {
		_, _ = memory.Append(t.Context(), payload.ID, message)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/agent/messages/user-2", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"draft":"Revise this"`) || strings.Contains(recorder.Body.String(), "Latest answer") || !strings.Contains(recorder.Body.String(), "Earlier answer") {
		t.Fatalf("unexpected undo response: %d %s", recorder.Code, recorder.Body.String())
	}
}
