// Pure arithmetic evaluator behind the floating REPL's `calc` command. It
// replaces `new Function(...)`, which a Content-Security-Policy without
// 'unsafe-eval' blocks outright and which left a single regex as the only
// barrier between a visitor and arbitrary code execution.
//
// Grammar (all operators left-associative except exponentiation):
//   expression := term (('+' | '-') term)*
//   term       := unary (('*' | '/' | '%') unary)*
//   unary      := ('+' | '-') unary | power
//   power      := primary (('^' | '**') unary)?
//   primary    := number | '(' expression ')'

const EXPONENT = "^";

type Token = { kind: "number"; value: number } | { kind: "operator"; value: string } | { kind: "paren"; value: "(" | ")" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push({ kind: "paren", value: character });
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(character)) {
      const match = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/.exec(source.slice(index));
      if (!match) throw new Error(`invalid number at offset ${index}`);
      tokens.push({ kind: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    // "**" is accepted as an alias for "^" so expressions written either way
    // keep evaluating the same after the move away from eval.
    if (character === "*" && source[index + 1] === "*") {
      tokens.push({ kind: "operator", value: EXPONENT });
      index += 2;
      continue;
    }
    if ("+-*/%^".includes(character)) {
      tokens.push({ kind: "operator", value: character });
      index += 1;
      continue;
    }
    throw new Error(`unexpected character ${character}`);
  }
  return tokens;
}

export function evaluateArithmetic(source: string): number {
  const tokens = tokenize(source);
  let position = 0;

  const peek = (): Token | undefined => tokens[position];

  const isOperator = (token: Token | undefined, ...values: string[]): token is { kind: "operator"; value: string } =>
    token?.kind === "operator" && values.includes(token.value);

  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      const token = peek();
      if (!isOperator(token, "+", "-")) return value;
      position += 1;
      const right = parseTerm();
      value = token.value === "+" ? value + right : value - right;
    }
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (;;) {
      const token = peek();
      if (!isOperator(token, "*", "/", "%")) return value;
      position += 1;
      const right = parseUnary();
      if (right === 0 && (token.value === "/" || token.value === "%")) throw new Error("division by zero");
      value = token.value === "*" ? value * right : token.value === "/" ? value / right : value % right;
    }
  }

  function parseUnary(): number {
    const token = peek();
    if (isOperator(token, "+", "-")) {
      position += 1;
      const operand = parseUnary();
      return token.value === "-" ? -operand : operand;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (!isOperator(peek(), EXPONENT)) return base;
    position += 1;
    // Right-associative: 2^3^2 evaluates as 2^(3^2).
    return base ** parseUnary();
  }

  function parsePrimary(): number {
    const token = peek();
    if (!token) throw new Error("unexpected end of expression");
    if (token.kind === "number") {
      position += 1;
      return token.value;
    }
    if (token.kind === "paren" && token.value === "(") {
      position += 1;
      const value = parseExpression();
      const closing = peek();
      if (closing?.kind !== "paren" || closing.value !== ")") throw new Error("missing closing parenthesis");
      position += 1;
      return value;
    }
    throw new Error("unexpected token");
  }

  if (tokens.length === 0) throw new Error("empty expression");
  const result = parseExpression();
  if (position !== tokens.length) throw new Error("unexpected trailing input");
  if (!Number.isFinite(result)) throw new Error("result is not a finite number");
  return result;
}
