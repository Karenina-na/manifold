package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"

	"github.com/manifold-space/manifold/app/core/internal/agent"
)

type Calculator struct{}

func (Calculator) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "calculator", Description: "Evaluate a finite arithmetic expression using +, -, *, / and parentheses.", Usage: "Use for arithmetic, numeric comparison, or unit conversion that can be expressed as arithmetic; do not estimate a result manually.", Parameters: json.RawMessage(`{"type":"object","properties":{"expression":{"type":"string","description":"Arithmetic expression"}},"required":["expression"],"additionalProperties":false}`)}
}

func (Calculator) Execute(_ context.Context, arguments json.RawMessage) (any, error) {
	var input struct {
		Expression string `json:"expression"`
	}
	if err := json.Unmarshal(arguments, &input); err != nil {
		return nil, fmt.Errorf("decode calculator arguments: %w", err)
	}
	if strings.TrimSpace(input.Expression) == "" || len(input.Expression) > 200 {
		return nil, errors.New("expression must contain 1 to 200 characters")
	}
	parser := expressionParser{input: input.Expression}
	value, err := parser.parseExpression()
	if err != nil {
		return nil, err
	}
	parser.skipSpace()
	if parser.position != len(parser.input) {
		return nil, fmt.Errorf("unexpected token at position %d", parser.position)
	}
	if math.IsInf(value, 0) || math.IsNaN(value) {
		return nil, errors.New("expression result must be finite")
	}
	return map[string]any{"expression": input.Expression, "result": value}, nil
}

type expressionParser struct {
	input    string
	position int
}

func (p *expressionParser) parseExpression() (float64, error) {
	value, err := p.parseTerm()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpace()
		if !p.consume('+') && !p.consume('-') {
			return value, nil
		}
		op := p.input[p.position-1]
		right, err := p.parseTerm()
		if err != nil {
			return 0, err
		}
		if op == '+' {
			value += right
		} else {
			value -= right
		}
	}
}

func (p *expressionParser) parseTerm() (float64, error) {
	value, err := p.parseFactor()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpace()
		if !p.consume('*') && !p.consume('/') {
			return value, nil
		}
		op := p.input[p.position-1]
		right, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		if op == '*' {
			value *= right
		} else if right == 0 {
			return 0, errors.New("division by zero")
		} else {
			value /= right
		}
	}
}

func (p *expressionParser) parseFactor() (float64, error) {
	p.skipSpace()
	if p.consume('+') {
		return p.parseFactor()
	}
	if p.consume('-') {
		value, err := p.parseFactor()
		return -value, err
	}
	if p.consume('(') {
		value, err := p.parseExpression()
		if err != nil {
			return 0, err
		}
		p.skipSpace()
		if !p.consume(')') {
			return 0, errors.New("missing closing parenthesis")
		}
		return value, nil
	}
	start := p.position
	for p.position < len(p.input) {
		r := rune(p.input[p.position])
		if !unicode.IsDigit(r) && r != '.' {
			break
		}
		p.position++
	}
	if start == p.position {
		return 0, fmt.Errorf("number expected at position %d", start)
	}
	value, err := strconv.ParseFloat(p.input[start:p.position], 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number at position %d", start)
	}
	return value, nil
}

func (p *expressionParser) skipSpace() {
	for p.position < len(p.input) && unicode.IsSpace(rune(p.input[p.position])) {
		p.position++
	}
}
func (p *expressionParser) consume(expected byte) bool {
	if p.position < len(p.input) && p.input[p.position] == expected {
		p.position++
		return true
	}
	return false
}
