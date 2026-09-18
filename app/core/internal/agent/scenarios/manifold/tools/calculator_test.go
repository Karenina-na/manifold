package tools_test

import (
	"encoding/json"
	"math"
	"testing"

	manifoldtools "github.com/manifold-space/manifold/app/core/internal/agent/scenarios/manifold/tools"
)

func TestCalculatorEvaluatesArithmeticWithPrecedence(t *testing.T) {
	result, err := (manifoldtools.Calculator{}).Execute(t.Context(), json.RawMessage(`{"expression":"(2 + 3) * 4 / 2"}`))
	if err != nil {
		t.Fatal(err)
	}
	value := result.(map[string]any)["result"].(float64)
	if math.Abs(value-10) > 1e-9 {
		t.Fatalf("result = %v", value)
	}
}

func TestCalculatorRejectsInvalidAndNonFiniteExpressions(t *testing.T) {
	for _, arguments := range []string{`{"expression":"2 + nope"}`, `{"expression":"1 / 0"}`, `{"expression":""}`} {
		if _, err := (manifoldtools.Calculator{}).Execute(t.Context(), json.RawMessage(arguments)); err == nil {
			t.Fatalf("expected %s to fail", arguments)
		}
	}
}
