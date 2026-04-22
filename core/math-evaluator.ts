/**
 * math-evaluator.ts - Math Expression Evaluation Service
 *
 * Content fields often need computed values: product price * quantity,
 * discount calculations, statistical aggregations, formula fields.
 * Dynamic code execution is a security risk. This provides safe
 * mathematical evaluation without arbitrary code execution.
 *
 * Drupal equivalent: ExpressionLanguage (but simpler, math-only).
 *
 * - Token-based parser (lexer + parser)
 * - NO dynamic code execution, NO Function constructor
 * - Supports arithmetic, parentheses, functions, variables
 * - Whitelist approach: only known operators and functions allowed
 * - Returns numbers, not strings (type-safe)
 */

const TokenType = {
  NUMBER: 'NUMBER',
  OPERATOR: 'OPERATOR',
  FUNCTION: 'FUNCTION',
  VARIABLE: 'VARIABLE',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  COMMA: 'COMMA',
  EOF: 'EOF',
} as const;

type TokenTypeName = (typeof TokenType)[keyof typeof TokenType];

interface Token {
  type: TokenTypeName;
  value?: string | number;
}

type MathFn = (...args: number[]) => number;

const MATH_FUNCTIONS: Record<string, MathFn> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log,
  exp: Math.exp,
};

function tokenize(expression: string): Token[] {
  if (typeof expression !== 'string') {
    throw new Error('Expression must be a string');
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];
    if (char === undefined) break;

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    const nextChar = expression[i + 1];
    if (/\d/.test(char) || (char === '.' && nextChar !== undefined && /\d/.test(nextChar))) {
      let num = '';
      while (i < expression.length) {
        const c = expression[i];
        if (c === undefined) break;
        if (/[\d.]/.test(c)) {
          num += c;
          i++;
        } else if (/[eE]/.test(c) && i + 1 < expression.length) {
          const next = expression[i + 1];
          const after = expression[i + 2];
          if (
            next !== undefined &&
            (/\d/.test(next) ||
              (['+', '-'].includes(next) && after !== undefined && /\d/.test(after)))
          ) {
            num += c;
            i++;
            const sign = expression[i];
            if (sign !== undefined && ['+', '-'].includes(sign)) {
              num += sign;
              i++;
            }
          } else {
            break;
          }
        } else {
          break;
        }
      }
      tokens.push({ type: TokenType.NUMBER, value: parseFloat(num) });
      continue;
    }

    if (char === '*' && expression[i + 1] === '*') {
      tokens.push({ type: TokenType.OPERATOR, value: '**' });
      i += 2;
      continue;
    }

    if ('+-*/%'.includes(char)) {
      tokens.push({ type: TokenType.OPERATOR, value: char });
      i++;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: TokenType.LPAREN, value: char });
      i++;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: TokenType.RPAREN, value: char });
      i++;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: TokenType.COMMA, value: char });
      i++;
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      let identifier = '';
      while (i < expression.length) {
        const c = expression[i];
        if (c === undefined || !/[a-zA-Z0-9_]/.test(c)) break;
        identifier += c;
        i++;
      }

      if (i < expression.length && expression[i] === '(') {
        tokens.push({ type: TokenType.FUNCTION, value: identifier });
      } else {
        tokens.push({ type: TokenType.VARIABLE, value: identifier });
      }
      continue;
    }

    throw new Error(`Unexpected character at position ${i}: '${char}'`);
  }

  tokens.push({ type: TokenType.EOF });
  return tokens;
}

class Parser {
  tokens: Token[];
  variables: Record<string, number>;
  current: number;

  constructor(tokens: Token[], variables: Record<string, number> = {}) {
    this.tokens = tokens;
    this.variables = variables;
    this.current = 0;
  }

  parse(): number {
    const result = this.expression();

    if (this.peek().type !== TokenType.EOF) {
      throw new Error(`Unexpected token: ${this.peek().value}`);
    }

    return result;
  }

  expression(): number {
    let left = this.term();

    while (
      this.peek().type === TokenType.OPERATOR &&
      ['+', '-'].includes(String(this.peek().value))
    ) {
      this.current++;
      const op = String(this.previous().value);
      const right = this.term();

      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  term(): number {
    let left = this.factor();

    while (
      this.peek().type === TokenType.OPERATOR &&
      ['*', '/', '%'].includes(String(this.peek().value))
    ) {
      this.current++;
      const op = String(this.previous().value);
      const right = this.factor();

      if (op === '*') {
        left = left * right;
      } else if (op === '/') {
        if (right === 0) {
          throw new Error('Division by zero');
        }
        left = left / right;
      } else {
        left = left % right;
      }
    }

    return left;
  }

  factor(): number {
    let left = this.unary();

    while (this.peek().type === TokenType.OPERATOR && this.peek().value === '**') {
      this.current++;
      const right = this.unary();
      left = Math.pow(left, right);
    }

    return left;
  }

  unary(): number {
    if (
      this.peek().type === TokenType.OPERATOR &&
      ['+', '-'].includes(String(this.peek().value))
    ) {
      this.current++;
      const op = String(this.previous().value);
      const value = this.unary();
      return op === '-' ? -value : value;
    }

    return this.primary();
  }

  primary(): number {
    if (this.match(TokenType.NUMBER)) {
      return Number(this.previous().value);
    }

    if (this.match(TokenType.VARIABLE)) {
      const varName = String(this.previous().value);

      if (
        varName.startsWith('__') ||
        ['constructor', 'prototype', '__proto__'].includes(varName)
      ) {
        throw new Error(`Forbidden variable name: ${varName}`);
      }

      if (!(varName in this.variables)) {
        throw new Error(`Undefined variable: ${varName}`);
      }

      const v = this.variables[varName];
      if (typeof v !== 'number') {
        throw new Error(`Variable ${varName} is not a number`);
      }
      return v;
    }

    if (this.match(TokenType.FUNCTION)) {
      const funcName = String(this.previous().value);

      const fn = MATH_FUNCTIONS[funcName];
      if (!fn) {
        throw new Error(`Unknown function: ${funcName}`);
      }

      if (!this.match(TokenType.LPAREN)) {
        throw new Error(`Expected '(' after function name`);
      }

      const args: number[] = [];

      if (this.peek().type !== TokenType.RPAREN) {
        do {
          args.push(this.expression());
        } while (this.match(TokenType.COMMA));
      }

      if (!this.match(TokenType.RPAREN)) {
        throw new Error(`Expected ')' after function arguments`);
      }

      return fn(...args);
    }

    if (this.match(TokenType.LPAREN)) {
      const value = this.expression();

      if (!this.match(TokenType.RPAREN)) {
        throw new Error(`Expected ')' after expression`);
      }

      return value;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(this.peek())}`);
  }

  match(type: TokenTypeName): boolean {
    if (this.peek().type === type) {
      this.current++;
      return true;
    }
    return false;
  }

  peek(offset: number = 0): Token {
    const tok = this.tokens[this.current + offset];
    if (tok) return tok;
    const last = this.tokens[this.tokens.length - 1];
    if (!last) return { type: TokenType.EOF };
    return last;
  }

  previous(): Token {
    const tok = this.tokens[this.current - 1];
    if (!tok) throw new Error('Parser error: no previous token');
    return tok;
  }
}

export function evaluate(
  expression: string,
  variables: Record<string, number> = {}
): number {
  if (!expression || typeof expression !== 'string') {
    throw new Error('Expression must be a non-empty string');
  }

  if (variables && typeof variables !== 'object') {
    throw new Error('Variables must be an object');
  }

  try {
    const tokens = tokenize(expression);
    const parser = new Parser(tokens, variables || {});
    const result = parser.parse();

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Expression did not evaluate to a finite number');
    }

    return result;
  } catch (error) {
    throw new Error(`Math evaluation error: ${(error as Error).message}`);
  }
}

export function validate(expression: string): { valid: boolean; error: string | null } {
  try {
    evaluate(expression, {});
    return { valid: true, error: null };
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('Undefined variable')) {
      return { valid: true, error: null };
    }
    return { valid: false, error: msg };
  }
}

export function listFunctions(): string[] {
  return Object.keys(MATH_FUNCTIONS).sort();
}

export function hasFunction(name: string): boolean {
  return name in MATH_FUNCTIONS;
}

interface LegacyServices {
  register?: (name: string, factory: () => unknown) => void;
}

interface Container {
  register?: (
    name: string,
    factory: () => unknown,
    meta?: { tags?: string[]; singleton?: boolean }
  ) => void;
}

export function register(
  services: LegacyServices | null | undefined,
  container: Container | null | undefined
): void {
  const api = {
    evaluate,
    validate,
    listFunctions,
    hasFunction,
  };

  if (services && typeof services.register === 'function') {
    services.register('math_evaluator', () => api);
  }

  if (container && typeof container.register === 'function') {
    container.register('math_evaluator', () => api, {
      tags: ['service', 'math', 'evaluation'],
      singleton: true,
    });
  }
}
