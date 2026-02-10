/**
 * math-evaluator.js - Math Expression Evaluation Service
 *
 * WHY THIS EXISTS:
 * Content fields often need computed values: product price * quantity,
 * discount calculations, statistical aggregations, formula fields.
 * eval() is a security risk. This provides safe mathematical evaluation
 * without arbitrary code execution.
 *
 * Drupal equivalent: ExpressionLanguage (but simpler, math-only)
 *
 * DESIGN DECISION:
 * - Token-based parser (lexer + parser)
 * - No eval() or Function constructor
 * - Supports arithmetic, parentheses, functions, variables
 * - Whitelist approach: only known operators and functions allowed
 * - Returns numbers, not strings (type-safe)
 *
 * @example Simple arithmetic
 * ```javascript
 * evaluate('2 + 2') // => 4
 * evaluate('(3 + 4) * 2') // => 14
 * evaluate('sqrt(16) + abs(-5)') // => 9
 * ```
 *
 * @example Variable substitution
 * ```javascript
 * evaluate('price * quantity', { price: 10, quantity: 3 }) // => 30
 * evaluate('(total - discount) * taxRate', {
 *   total: 100,
 *   discount: 10,
 *   taxRate: 1.1
 * }) // => 99
 * ```
 */

/**
 * Token types for lexer
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
};

/**
 * Supported math functions
 * WHY WHITELIST: Only allow safe mathematical operations
 */
const MATH_FUNCTIONS = {
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

/**
 * Operator precedence (higher = evaluated first)
 */
const PRECEDENCE = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '%': 2,
  '**': 3,
};

/**
 * Tokenize an expression string
 *
 * @param {string} expression - Math expression
 * @returns {array} - Array of tokens
 *
 * WHY TOKENIZE:
 * Breaking the expression into tokens makes parsing easier and safer.
 * We can validate each token before evaluation.
 */
function tokenize(expression) {
  if (typeof expression !== 'string') {
    throw new Error('Expression must be a string');
  }

  const tokens = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Numbers (including decimals and scientific notation)
    if (/\d/.test(char) || (char === '.' && /\d/.test(expression[i + 1]))) {
      let num = '';
      while (i < expression.length) {
        const c = expression[i];
        // Digits and decimal point
        if (/[\d.]/.test(c)) {
          num += c;
          i++;
        }
        // Scientific notation: e or E followed by optional +/- and digits
        else if (/[eE]/.test(c) && i + 1 < expression.length) {
          const next = expression[i + 1];
          if (/\d/.test(next) || (['+', '-'].includes(next) && i + 2 < expression.length && /\d/.test(expression[i + 2]))) {
            num += c;
            i++;
            if (['+', '-'].includes(expression[i])) {
              num += expression[i];
              i++;
            }
          } else {
            break;
          }
        }
        else {
          break;
        }
      }
      tokens.push({ type: TokenType.NUMBER, value: parseFloat(num) });
      continue;
    }

    // Power operator (**) - check BEFORE single * operator
    if (char === '*' && expression[i + 1] === '*') {
      tokens.push({ type: TokenType.OPERATOR, value: '**' });
      i += 2;
      continue;
    }

    // Operators
    if ('+-*/%'.includes(char)) {
      tokens.push({ type: TokenType.OPERATOR, value: char });
      i++;
      continue;
    }

    // Parentheses
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

    // Comma (for function arguments)
    if (char === ',') {
      tokens.push({ type: TokenType.COMMA, value: char });
      i++;
      continue;
    }

    // Functions and variables (identifiers)
    if (/[a-zA-Z_]/.test(char)) {
      let identifier = '';
      while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) {
        identifier += expression[i];
        i++;
      }

      // Check if it's a function (followed by '(')
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

/**
 * Parser class
 * Implements recursive descent parser for math expressions
 *
 * Grammar:
 * expression := term (('+' | '-') term)*
 * term       := factor (('*' | '/' | '%') factor)*
 * factor     := power ('**' power)*
 * power      := unary
 * unary      := ('-' | '+')? primary
 * primary    := NUMBER | VARIABLE | FUNCTION '(' args ')' | '(' expression ')'
 * args       := expression (',' expression)*
 */
class Parser {
  constructor(tokens, variables = {}) {
    this.tokens = tokens;
    this.variables = variables;
    this.current = 0;
  }

  /**
   * Parse the expression
   */
  parse() {
    const result = this.expression();

    if (this.peek().type !== TokenType.EOF) {
      throw new Error(`Unexpected token: ${this.peek().value}`);
    }

    return result;
  }

  /**
   * expression := term (('+' | '-') term)*
   */
  expression() {
    let left = this.term();

    while (this.peek().type === TokenType.OPERATOR && ['+', '-'].includes(this.peek().value)) {
      this.current++; // advance
      const op = this.previous().value;
      const right = this.term();

      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  /**
   * term := factor (('*' | '/' | '%') factor)*
   */
  term() {
    let left = this.factor();

    while (this.peek().type === TokenType.OPERATOR && ['*', '/', '%'].includes(this.peek().value)) {
      this.current++; // advance
      const op = this.previous().value;
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

  /**
   * factor := power ('**' power)*
   */
  factor() {
    let left = this.unary();

    while (this.peek().type === TokenType.OPERATOR && this.peek().value === '**') {
      this.current++; // advance
      const right = this.unary();
      left = Math.pow(left, right);
    }

    return left;
  }

  /**
   * unary := ('-' | '+')? primary
   */
  unary() {
    if (this.peek().type === TokenType.OPERATOR && ['+', '-'].includes(this.peek().value)) {
      this.current++; // advance
      const op = this.previous().value;
      const value = this.unary();
      return op === '-' ? -value : value;
    }

    return this.primary();
  }

  /**
   * primary := NUMBER | VARIABLE | FUNCTION '(' args ')' | '(' expression ')'
   */
  primary() {
    // Number literal
    if (this.match(TokenType.NUMBER)) {
      return this.previous().value;
    }

    // Variable
    if (this.match(TokenType.VARIABLE)) {
      const varName = this.previous().value;

      // Security check: prevent access to dangerous properties
      if (varName.startsWith('__') || ['constructor', 'prototype', '__proto__'].includes(varName)) {
        throw new Error(`Forbidden variable name: ${varName}`);
      }

      if (!(varName in this.variables)) {
        throw new Error(`Undefined variable: ${varName}`);
      }

      return this.variables[varName];
    }

    // Function call
    if (this.match(TokenType.FUNCTION)) {
      const funcName = this.previous().value;

      // Security check: only allow whitelisted functions
      if (!(funcName in MATH_FUNCTIONS)) {
        throw new Error(`Unknown function: ${funcName}`);
      }

      // Expect '('
      if (!this.match(TokenType.LPAREN)) {
        throw new Error(`Expected '(' after function name`);
      }

      // Parse arguments
      const args = [];

      // Handle empty argument list: sqrt()
      if (this.peek().type !== TokenType.RPAREN) {
        do {
          args.push(this.expression());
        } while (this.match(TokenType.COMMA));
      }

      // Expect ')'
      if (!this.match(TokenType.RPAREN)) {
        throw new Error(`Expected ')' after function arguments`);
      }

      // Call the function
      return MATH_FUNCTIONS[funcName](...args);
    }

    // Parenthesized expression
    if (this.match(TokenType.LPAREN)) {
      const value = this.expression();

      if (!this.match(TokenType.RPAREN)) {
        throw new Error(`Expected ')' after expression`);
      }

      return value;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(this.peek())}`);
  }

  /**
   * Check if current token matches type and advance if so
   */
  match(type) {
    if (this.peek().type === type) {
      this.current++;
      return true;
    }
    return false;
  }

  /**
   * Get current token (with optional offset)
   */
  peek(offset = 0) {
    return this.tokens[this.current + offset] || this.tokens[this.tokens.length - 1];
  }

  /**
   * Get previous token
   */
  previous() {
    return this.tokens[this.current - 1];
  }
}

/**
 * Evaluate a mathematical expression
 *
 * @param {string} expression - Math expression to evaluate
 * @param {object} variables - Variable values for substitution
 * @returns {number} - Result of evaluation
 *
 * WHY SAFE:
 * - No eval() or Function constructor
 * - Whitelist of allowed functions
 * - No property access (no dots)
 * - Variables checked against blacklist
 */
export function evaluate(expression, variables = {}) {
  if (!expression || typeof expression !== 'string') {
    throw new Error('Expression must be a non-empty string');
  }

  if (variables && typeof variables !== 'object') {
    throw new Error('Variables must be an object');
  }

  try {
    // Tokenize
    const tokens = tokenize(expression);

    // Parse and evaluate
    const parser = new Parser(tokens, variables || {});
    const result = parser.parse();

    // Ensure result is a number
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Expression did not evaluate to a finite number');
    }

    return result;
  } catch (error) {
    throw new Error(`Math evaluation error: ${error.message}`);
  }
}

/**
 * Validate an expression without evaluating it
 *
 * @param {string} expression - Math expression to validate
 * @returns {object} - { valid: boolean, error: string|null }
 */
export function validate(expression) {
  try {
    evaluate(expression, {});
    return { valid: true, error: null };
  } catch (error) {
    // Check if it's a variable error (expected during validation)
    if (error.message.includes('Undefined variable')) {
      return { valid: true, error: null };
    }
    return { valid: false, error: error.message };
  }
}

/**
 * List available math functions
 *
 * @returns {string[]} - Array of function names
 */
export function listFunctions() {
  return Object.keys(MATH_FUNCTIONS).sort();
}

/**
 * Check if a function is available
 *
 * @param {string} name - Function name
 * @returns {boolean} - True if function exists
 */
export function hasFunction(name) {
  return name in MATH_FUNCTIONS;
}

// ============================================
// SERVICE REGISTRATION
// ============================================

/**
 * Register the math evaluator service
 *
 * @param {Object} services - Legacy services registry
 * @param {Object} container - DI container
 */
export function register(services, container) {
  const api = {
    evaluate,
    validate,
    listFunctions,
    hasFunction,
  };

  // Legacy pattern
  if (services && typeof services.register === 'function') {
    services.register('math_evaluator', () => api);
  }

  // New container pattern
  if (container && typeof container.register === 'function') {
    container.register('math_evaluator', () => api, {
      tags: ['service', 'math', 'evaluation'],
      singleton: true,
    });
  }
}
