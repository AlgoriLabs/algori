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

describe("Interpreter", () => {
  describe("variable declarations", () => {
    it("declares and initializes variables", () => {
      const lines = runCodeLines("programa { mostrar(5) }");
      expect(lines[0]).toBe("5");
    });

    it("handles default values", () => {
      const interp = runCode("programa { inteiro x }");
      expect(interp.variables.get("x")).toBe(0);
    });

    it("handles texto default", () => {
      const interp = runCode("programa { texto nome }");
      expect(interp.variables.get("nome")).toBe("");
    });

    it("handles logico default", () => {
      const interp = runCode("programa { logico flag }");
      expect(interp.variables.get("flag")).toBe(false);
    });
  });

  describe("constants", () => {
    it("allows reading constants", () => {
      const lines = runCodeLines(
        "programa { constante PI = 3.14\nmostrar(PI) }",
      );
      expect(lines[0]).toBe("3.14");
    });

    it("rejects constant reassignment", () => {
      expect(() =>
        runCode("programa { constante PI = 3.14\nPI = 3.0 }"),
      ).toThrow("constante");
    });
  });

  describe("assignments", () => {
    it("assigns values", () => {
      const interp = runCode("programa { inteiro x\nx = 10 }");
      expect(interp.variables.get("x")).toBe(10);
    });

    it("rejects undeclared variable", () => {
      expect(() => runCode("programa { y = 10 }")).toThrow("não declarada");
    });
  });

  describe("arrays", () => {
    it("declares and accesses arrays", () => {
      const lines = runCodeLines(
        "programa { inteiro vetor[3]\nvetor[0] = 42\nmostrar(vetor[0]) }",
      );
      expect(lines[0]).toBe("42");
    });

    it("assigns with dynamic index", () => {
      const lines = runCodeLines(
        "programa { inteiro v[5]\npara (inteiro i = 0; i < 5; i = i + 1) { v[i] = i * 10 }\nmostrar(v[2]) }",
      );
      expect(lines[0]).toBe("20");
    });

    it("pre-allocates array with declared size", () => {
      const interp = runCode("programa { inteiro vetor[5] }");
      const arr = interp.variables.get("vetor") as number[];
      expect(arr).toHaveLength(5);
      expect(arr[0]).toBe(0);
    });

    it("pre-allocates 2D matrix", () => {
      const interp = runCode("programa { real matriz[3][4] }");
      const mat = interp.variables.get("matriz") as number[][];
      expect(mat).toHaveLength(3);
      expect(mat[0]).toHaveLength(4);
    });

    it("reads 2D matrix element", () => {
      const lines = runCodeLines(
        "programa { real matriz[3][4]\nmatriz[1][2] = 42\nmostrar(matriz[1][2]) }",
      );
      expect(lines[0]).toBe("42");
    });

    it("writes 2D matrix element", () => {
      const interp = runCode(
        "programa { real matriz[2][3]\nmatriz[0][1] = 99\nmatriz[1][2] = 77 }",
      );
      const mat = interp.variables.get("matriz") as number[][];
      expect(mat[0][1]).toBe(99);
      expect(mat[1][2]).toBe(77);
    });

    it("reads and writes 2D matrix with loop", () => {
      const lines = runCodeLines(
        "programa { real matriz[3][3]\npara (inteiro i = 0; i < 3; i = i + 1) {\n  para (inteiro j = 0; j < 3; j = j + 1) {\n    matriz[i][j] = i * 3 + j\n  }\n}\nmostrar(matriz[2][1]) }",
      );
      expect(lines[0]).toBe("7");
    });

    it("throws on 2D matrix index out of bounds (read)", () => {
      expectRuntimeError(
        "programa { real matriz[3][4]\nmostrar(matriz[5][2]) }",
        "fora dos limites",
      );
    });

    it("throws on 2D matrix index out of bounds (write)", () => {
      expectRuntimeError(
        "programa { real matriz[3][4]\nmatriz[1][10] = 5 }",
        "fora dos limites",
      );
    });
  });

  describe("I/O", () => {
    it("prints values", () => {
      const lines = runCodeLines('programa { mostrar("hello") }');
      expect(lines[0]).toBe("hello");
    });

    it("prints multiple values", () => {
      const lines = runCodeLines("programa { mostrar(1, 2, 3) }");
      expect(lines[0]).toBe("123");
    });

    it("handles input request", () => {
      const tokens = tokenize("programa { capturar(x) }");
      const ast = parse(tokens);
      const interp = new Interpreter();
      interp.variables.set("x", 0);
      expect(() => interp.run(ast)).toThrow(InputRequestError);
    });

    it("handles capturar() as expression without parentheses", () => {
      const tokens = tokenize("programa { inteiro x = capturar }");
      const ast = parse(tokens);
      const interp = new Interpreter();
      expect(() => interp.run(ast)).toThrow(InputRequestError);
    });

    it("handles capturar() as expression with parentheses", () => {
      const tokens = tokenize("programa { inteiro x = capturar() }");
      const ast = parse(tokens);
      const interp = new Interpreter();
      expect(() => interp.run(ast)).toThrow(InputRequestError);
    });

    it("handles ler() as expression", () => {
      const tokens = tokenize("programa { inteiro x = ler() }");
      const ast = parse(tokens);
      const interp = new Interpreter();
      expect(() => interp.run(ast)).toThrow(InputRequestError);
    });
    it("resumes capturar() with resolved input value", () => {
      const tokens = tokenize(
        `programa {mostrar("inicio") texto nome = capturar() mostrar(nome)}`,
      );
      const ast = parse(tokens);
      const interp = new Interpreter();

      expect(() => interp.run(ast)).toThrow(InputRequestError);

      const outputBeforeInput = interp.console
        .filter((line) => line.type === "output")
        .map((line) => line.text);

      expect(outputBeforeInput).toEqual(["inicio"]);

      const resumeIndex = interp.currentExecIndex;
      expect(resumeIndex).toBe(1);

      interp.inputResolved = true;
      interp.lastInputValue = "Franklin";

      interp.execBlockFrom(ast, resumeIndex);

      const outputAfterInput = interp.console
        .filter((line) => line.type === "output")
        .map((line) => line.text);

      expect(outputAfterInput).toEqual(["inicio", "Franklin"]);
    });
  });

  describe("control flow", () => {
    it("executes se/entao", () => {
      const lines = runCodeLines(
        'programa { inteiro x = 5\nse (x > 0) { mostrar("pos") } }',
      );
      expect(lines[0]).toBe("pos");
    });

    it("executes se/senao", () => {
      const lines = runCodeLines(
        'programa { inteiro x = -1\nse (x > 0) { mostrar("pos") } senao { mostrar("neg") } }',
      );
      expect(lines[0]).toBe("neg");
    });

    it("executes enquanto", () => {
      const lines = runCodeLines(
        "programa { inteiro x = 0\nenquanto (x < 3) { x = x + 1 }\nmostrar(x) }",
      );
      expect(lines[0]).toBe("3");
    });

    it("executes para legacy", () => {
      const lines = runCodeLines(
        "programa { inteiro soma = 0\npara i de 1 ate 3 { soma = soma + i }\nmostrar(soma) }",
      );
      expect(lines[0]).toBe("6");
    });

    it("pare exits loop early", () => {
      const lines = runCodeLines(
        "programa { inteiro x = 0\nenquanto (verdadeiro) { x = x + 1\nse (x >= 5) { pare } }\nmostrar(x) }",
      );
      expect(lines[0]).toBe("5");
    });

    it("continua skips to next iteration", () => {
      const lines = runCodeLines(
        "programa { inteiro soma = 0\npara i de 1 ate 5 {\nse (i == 3) { continua }\nsoma = soma + i\n}\nmostrar(soma) }",
      );
      expect(lines[0]).toBe("12");
    });

    it("continua works in C-style for without skipping update", () => {
      const lines = runCodeLines(
        "programa { inteiro soma = 0\npara (inteiro i = 0; i < 5; i = i + 1) {\nse (i == 2) { continua }\nsoma = soma + i\n}\nmostrar(soma) }",
      );
      expect(lines[0]).toBe("8");
    });
  });

  describe("functions", () => {
    it("declares and calls functions", () => {
      const lines = runCodeLines(
        "programa { funcao inteiro dobro(inteiro x) { retorne x * 2 }\nmostrar(dobro(5)) }",
      );
      expect(lines[0]).toBe("10");
    });

    it("supports multiple parameters", () => {
      const lines = runCodeLines(
        "programa { funcao inteiro soma(inteiro a, inteiro b) { retorne a + b }\nmostrar(soma(3, 4)) }",
      );
      expect(lines[0]).toBe("7");
    });

    it("preserves global variable mutations", () => {
      const interp = runCode(
        "programa { inteiro contador = 0\nfuncao vazio incrementar() { contador = contador + 1 }\nincrementar()\nincrementar()\nincrementar() }",
      );
      expect(interp.variables.get("contador")).toBe(3);
    });

    it("throws RuntimeError when pare leaks through function call", () => {
      expectRuntimeError(
        "programa { funcao vazio pareTudo() { pare }\ninteiro i = 0\nenquanto (i < 10) {\ni = i + 1\nse (i == 3) { pareTudo() }\n}\nmostrar(i) }",
        "fora de um loop",
      );
    });

    it("throws RuntimeError when continua leaks through function call", () => {
      expectRuntimeError(
        "programa { funcao vazio continuaTudo() { continua }\npara i de 1 ate 5 {\nse (i == 3) { continuaTudo() }\n} }",
        "fora de um loop",
      );
    });

    it("does not leak local variables to global scope", () => {
      expectRuntimeError(
        "programa { funcao vazio teste() { inteiro local = 99 }\nteste()\nmostrar(local) }",
        "não definida",
      );
    });

    it("keeps local variables from different functions isolated", () => {
      const lines = runCodeLines(
        "programa { funcao vazio f1() { inteiro x = 10\nmostrar(x) }\nfuncao vazio f2() { inteiro x = 20\nmostrar(x) }\nf1()\nf2() }",
      );
      expect(lines[0]).toBe("10");
      expect(lines[1]).toBe("20");
    });
  });

  describe("error cases", () => {
    it("throws on division by zero", () => {
      expectRuntimeError("programa { mostrar(10 / 0) }", "Divisão por zero");
    });

    it("throws on modulo by zero", () => {
      expectRuntimeError("programa { mostrar(10 % 0) }", "Divisão por zero");
    });

    it("throws on array index out of bounds (read)", () => {
      expectRuntimeError(
        "programa { inteiro vetor[3]\nmostrar(vetor[10]) }",
        "fora dos limites",
      );
    });

    it("throws on array index out of bounds (write)", () => {
      expectRuntimeError(
        "programa { inteiro vetor[3]\nvetor[10] = 5 }",
        "fora dos limites",
      );
    });

    it("throws on non-integer index", () => {
      expectRuntimeError(
        "programa { inteiro vetor[3]\nmostrar(vetor[1.5]) }",
        "Índice inválido",
      );
    });

    it("throws on undefined variable in expression", () => {
      expectRuntimeError("programa { mostrar(x) }", "não definida");
    });

    it("throws on function not found", () => {
      expectRuntimeError("programa { inexistente() }", "não encontrada");
    });

    it("throws on deep recursion", () => {
      expectRuntimeError(
        "programa { funcao vazio f() { f() }\nf() }",
        "Profundidade máxima de recursão",
      );
    });

    it("throws on infinite loop", () => {
      expectRuntimeError("programa { enquanto (verdadeiro) { } }", "iterações");
    });

    it("throws on invalid array access", () => {
      expectRuntimeError(
        "programa { inteiro x = 5\nmostrar(x[0]) }",
        "não é um array ou texto",
      );
    });

    it("throws on array_assign to non-array", () => {
      expectRuntimeError(
        "programa { inteiro x = 5\nx[0] = 10 }",
        "não é um array",
      );
    });
  });

  describe("iteration limit", () => {
    it("throws on infinite loop", () => {
      expect(() => runCode("programa { enquanto (verdadeiro) { } }")).toThrow(
        "iterações",
      );
    });
  });

  describe("error formatting", () => {
    it("does not duplicate 'Linha X:' prefix in RuntimeError.format()", () => {
      const err = new RuntimeError(1, "Divisão por zero");
      expect(err.format()).not.toMatch(/Linha \d+: Linha \d+:/);
      expect(err.format()).toBe("Linha 1: Divisão por zero");
    });

    it("does not duplicate 'Linha X:' prefix in ParseError.format()", () => {
      const err = new ParseError(5, "Token inesperado");
      expect(err.format()).not.toMatch(/Linha \d+: Linha \d+:/);
      expect(err.format()).toBe("Linha 5: Token inesperado");
    });

    it("includes hint and example without duplicating line prefix", () => {
      const err = new RuntimeError(3, "Erro", "Dica", "exemplo");
      const formatted = err.format();
      expect(formatted).not.toMatch(/Linha \d+: Linha \d+:/);
      expect(formatted).toBe("Linha 3: Erro|||Dica|||exemplo");
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      const interp = runCode("programa { inteiro x\nx = 5\nmostrar(x) }");
      expect(interp.variables.size).toBeGreaterThan(0);
      interp.reset();
      expect(interp.variables.size).toBe(0);
      expect(interp.console).toHaveLength(0);
    });
  });
});
