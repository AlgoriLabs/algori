import { describe, it, expect } from "vitest";
import { tokenize } from "../src/tokenizer.js";
import { parse } from "../src/parser.js";
import { Interpreter, InputRequestError } from "../src/interpreter.js";
import { RuntimeError, ParseError } from "../src/errors.js";

function runCode(code: string): Interpreter {
  const tokens = tokenize(code);
  const ast = parse(tokens);
  const interpreter = new Interpreter();
  interpreter.run(ast);
  return interpreter;
}

function runCodeLines(code: string): string[] {
  const interp = runCode(code);
  return interp.console.filter((l) => l.type === "output").map((l) => l.text);
}

function expectRuntimeError(code: string, match: string) {
  expect(() => runCode(code)).toThrow(RuntimeError);
  expect(() => runCode(code)).toThrow(match);
}

function expectParseError(code: string, match: string) {
  expect(() => runCode(code)).toThrow(ParseError);
  expect(() => runCode(code)).toThrow(match);
}

describe("Bug Hunting - Confirmed Bugs", () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // BUG-001: div keyword does regular division instead of integer division
  // Severity: HIGH - Language feature is broken
  // ═══════════════════════════════════════════════════════════════════════════
  describe("BUG-001: div keyword does regular division instead of integer division", () => {
    // ROOT CAUSE: In parser.ts parseMulDivMod() line 1032:
    //   const mappedOp = op.value === "mod" ? "%" : op.value === "div" ? "/" : op.value;
    // This maps "div" to "/" instead of keeping it as "div".
    // The interpreter has an applyBinOp case for "div" that does Math.floor(),
    // but it's never reached because the parser maps it to "/".
    //
    // FIX: Change parser.ts line 1032 from:
    //   op.value === "div" ? "/" : op.value
    // to:
    //   op.value === "div" ? "div" : op.value

    it("7 div 2 should be 3, not 3.5", () => {
      const interp = runCode('programa { mostrar(7 div 2) }');
      expect(interp.console[0].text).toBe("3");
    });

    it("-7 div 2 should be -4, not -3.5", () => {
      const interp = runCode('programa { mostrar(-7 div 2) }');
      expect(interp.console[0].text).toBe("-4");
    });

    it("100 div 3 should be 33, not 33.333...", () => {
      const interp = runCode('programa { mostrar(100 div 3) }');
      expect(interp.console[0].text).toBe("33");
    });

    it("div 0 should throw division by zero", () => {
      expectRuntimeError('programa { mostrar(10 div 0) }', "Divisão por zero");
    });

    it("div in variable assignment", () => {
      const interp = runCode('programa { inteiro x = 7 div 2\nmostrar(x) }');
      expect(interp.console[0].text).toBe("3");
    });

    it("div with expression", () => {
      const interp = runCode('programa { inteiro x = 10\nmostrar((x + 4) div 3) }');
      expect(interp.console[0].text).toBe("4");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUG-002: Tokenizer parses 1.2.3 as single number token
  // Severity: MEDIUM - Could cause unexpected behavior
  // ═══════════════════════════════════════════════════════════════════════════
  describe("BUG-002: Tokenizer parses 1.2.3 as single number token", () => {
    // ROOT CAUSE: In tokenizer.ts, the number parsing loop:
    //   while (pos < source.length && ((peek() >= "0" && peek() <= "9") || peek() === "."))
    // consumes multiple dots as part of a single number token.
    //
    // FIX: After the first dot, only consume digits, not more dots.

    it("1.2.3 should NOT be a single number token", () => {
      const tokens = tokenize('programa { mostrar(1.2.3) }');
      const numberTokens = tokens.filter(t => t.type === "NUMBER");
      expect(numberTokens[0].value).not.toBe("1.2.3");
    });

    it("valid decimal numbers still work", () => {
      const interp = runCode('programa { mostrar(3.14) }');
      expect(interp.console[0].text).toBe("3.14");
    });

    it("valid integers still work", () => {
      const interp = runCode('programa { mostrar(42) }');
      expect(interp.console[0].text).toBe("42");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUG-003: Leading dot .5 throws "Caractere inválido"
  // Severity: MEDIUM - Inconvenient for users
  // ═══════════════════════════════════════════════════════════════════════════
  describe("BUG-003: Leading dot .5 throws error", () => {
    // ROOT CAUSE: The tokenizer doesn't handle numbers starting with a dot.
    // When it encounters ".", it tries to parse a Portuguese boolean literal
    // (like ..verdadeiro..), and if that fails, it throws an error.
    //
    // FIX: Add handling for numbers starting with a dot (like .5 → 0.5).

    it(".5 should be parsed as 0.5", () => {
      const interp = runCode('programa { mostrar(.5) }');
      expect(interp.console[0].text).toBe("0.5");
    });

    it(".123 should be parsed as 0.123", () => {
      const interp = runCode('programa { mostrar(.123) }');
      expect(interp.console[0].text).toBe("0.123");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUG-004: evalUserFunction has different recursion limit than execUserFunction
  // Severity: MEDIUM - Inconsistent behavior
  // ═══════════════════════════════════════════════════════════════════════════
  describe("BUG-004: evalUserFunction has different recursion limit", () => {
    // ROOT CAUSE: In interpreter.ts:
    //   evalUserFunction (line 627): this.callStack.length > 50
    //   execUserFunction (line 400): this.callStack.length >= this.maxCallStackDepth
    //
    // This means functions called from expression context have a 50-call limit
    // while functions called from statement context have a 100-call limit.
    //
    // FIX: Use maxCallStackDepth for both.

    it("statement-level recursion works up to maxCallStackDepth", () => {
      const code = `
        programa {
          funcao vazio f(inteiro n) {
            se (n > 0) {
              f(n - 1)
            }
          }
          f(99)
        }
      `;
      const interp = runCode(code);
      expect(interp).toBeDefined();
    });

    it("expression-level recursion hits limit at 50 (should be 100)", () => {
      const code = `
        programa {
          funcao inteiro f(inteiro n) {
            se (n <= 0) {
              retorne 0
            } senao {
              retorne 1 + f(n - 1)
            }
          }
          mostrar(f(99))
        }
      `;
      // f(99) is called from expression context (mostrar(f(99)))
      // evalUserFunction uses hardcoded limit of 50
      // This fails at 50, not 100
      expectRuntimeError(code, "Pilha de chamadas muito profunda");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUG-005: modulo/raiz/potencia don't check for invalid inputs
  // Severity: LOW - Returns NaN instead of throwing error
  // ═══════════════════════════════════════════════════════════════════════════
  describe("BUG-005: Builtin functions don't validate inputs", () => {
    // ROOT CAUSE: The builtin functions don't check for invalid inputs
    // and return NaN instead of throwing meaningful errors.
    //
    // FIX: Add input validation to modulo, raiz, and potencia.

    it("modulo(10, 0) returns NaN instead of throwing error", () => {
      const interp = runCode('programa { mostrar(modulo(10, 0)) }');
      // Bug: returns "NaN" instead of throwing an error
      expect(interp.console[0].text).toBe("NaN");
    });

    it("raiz(-1) returns NaN instead of throwing error", () => {
      const interp = runCode('programa { mostrar(raiz(-1)) }');
      // Bug: returns "NaN" instead of throwing an error
      expect(interp.console[0].text).toBe("NaN");
    });

    it("potencia with negative exponent returns decimal", () => {
      const interp = runCode('programa { mostrar(potencia(2, -1)) }');
      // JS: 2 ** -1 = 0.5
      expect(interp.console[0].text).toBe("0.5");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUG-006: subtexto with start > end swaps indices (JS behavior)
  // Severity: LOW - Confusing but follows JS semantics
  // ═══════════════════════════════════════════════════════════════════════════
  describe("BUG-006: subtexto swaps indices when start > end", () => {
    // ROOT CAUSE: Uses JS substring() which swaps indices when start > end.
    // This is confusing for users who expect an error or empty string.
    //
    // FIX: Either validate indices or document this behavior.

    it("subtexto('hello', 3, 1) returns 'el' (swaps indices)", () => {
      const interp = runCode('programa { mostrar(subtexto("hello", 3, 1)) }');
      // JS: "hello".substring(3, 1) swaps to substring(1, 3) = "el"
      // This is confusing for users who expect an error or empty string
      expect(interp.console[0].text).toBe("el");
    });

    it("subtexto('hello', 1, 3) returns 'el'", () => {
      const interp = runCode('programa { mostrar(subtexto("hello", 1, 3)) }');
      expect(interp.console[0].text).toBe("el");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Additional edge cases that work correctly
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Working correctly", () => {
    it("mod as keyword operator works", () => {
      const interp = runCode('programa { mostrar(10 mod 3) }');
      expect(interp.console[0].text).toBe("1");
    });

    it("modulo as builtin function works", () => {
      const interp = runCode('programa { mostrar(modulo(10, 3)) }');
      expect(interp.console[0].text).toBe("1");
    });

    it("empty array literal [] works", () => {
      const interp = runCode('programa { mostrar([]) }');
      expect(interp.console[0].text).toBe("[]");
    });

    it("chained comparisons throw parse error (correct behavior)", () => {
      expectParseError('programa { mostrar(1 < 2 < 3) }', "Esperado símbolo \")\"");
    });

    it("use && for chained comparisons", () => {
      const interp = runCode('programa { mostrar(1 < 2 && 2 < 3) }');
      expect(interp.console[0].text).toBe("verdadeiro");
    });

    it("tamanho of empty string", () => {
      const interp = runCode('programa { mostrar(tamanho("")) }');
      expect(interp.console[0].text).toBe("0");
    });

    it("tamanho of string with special chars", () => {
      const interp = runCode('programa { mostrar(tamanho("olá mundo")) }');
      expect(interp.console[0].text).toBe("9");
    });

    it("maiusculo converts to uppercase", () => {
      const interp = runCode('programa { mostrar(maiusculo("hello")) }');
      expect(interp.console[0].text).toBe("HELLO");
    });

    it("minusculo converts to lowercase", () => {
      const interp = runCode('programa { mostrar(minusculo("HELLO")) }');
      expect(interp.console[0].text).toBe("hello");
    });

    it("string concatenation with numbers", () => {
      const interp = runCode('programa { mostrar("idade: " + 25) }');
      expect(interp.console[0].text).toBe("idade: 25");
    });

    it("boolean to string conversion", () => {
      const interp = runCode('programa { mostrar(verdadeiro) }');
      expect(interp.console[0].text).toBe("verdadeiro");
    });

    it("operator precedence works correctly", () => {
      const interp = runCode('programa { mostrar(2 + 3 * 4) }');
      expect(interp.console[0].text).toBe("14");
    });

    it("parentheses override precedence", () => {
      const interp = runCode('programa { mostrar((2 + 3) * 4) }');
      expect(interp.console[0].text).toBe("20");
    });

    it("unary minus before addition", () => {
      const interp = runCode('programa { mostrar(-2 + 3) }');
      expect(interp.console[0].text).toBe("1");
    });

    it("nested function calls", () => {
      const interp = runCode('programa { mostrar(maiusculo("hello")) }');
      expect(interp.console[0].text).toBe("HELLO");
    });

    it("arithmetic in function arguments", () => {
      const interp = runCode('programa { mostrar(raiz(9 + 16)) }');
      expect(interp.console[0].text).toBe("5");
    });

    it("for loop with negative step", () => {
      const code = `
        programa {
          inteiro soma = 0
          para i de 5 ate 1 passo -1 {
            soma = soma + i
          }
          mostrar(soma)
        }
      `;
      const interp = runCode(code);
      expect(interp.console[0].text).toBe("15");
    });

    it("recursive function works correctly", () => {
      const code = `
        programa {
          funcao inteiro fatorial(inteiro n) {
            se (n <= 1) {
              retorne 1
            } senao {
              retorne n * fatorial(n - 1)
            }
          }
          mostrar(fatorial(5))
        }
      `;
      const interp = runCode(code);
      expect(interp.console[0].text).toBe("120");
    });
  });
});
