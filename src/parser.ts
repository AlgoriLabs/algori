import type {
  Token,
  TokenType,
  ASTNode,
  ExprNode,
  VarDeclNode,
  AssignNode,
  ArrayAssignNode,
  PrintNode,
  InputNode,
  CallNode,
  IfNode,
  WhileNode,
  ForNode,
  ReturnNode,
  BreakNode,
  ContinueNode,
  FunctionDeclNode,
  ArrayNode,
  CallExprNode,
  FunctionParam,
} from "../types/index.js";
import { defaultValueForType } from "./utils.js";
import { ParseError } from "./errors.js";

const TOKEN_TYPE_NAMES: Record<TokenType, string> = {
  KEYWORD: "palavra-chave",
  IDENTIFIER: "identificador",
  NUMBER: "número",
  STRING: "texto",
  OPERATOR: "operador",
  PUNCTUATION: "símbolo",
  NEWLINE: "quebra de linha",
  EOF: "fim do arquivo",
};

function friendlyTokenName(type: TokenType): string {
  return TOKEN_TYPE_NAMES[type] || type;
}

function getErrorHint(tokenValue: string): string {
  const hints: Record<string, string> = {
    'fim': 'Use "fim" para fechar um bloco de código.',
    'fimse': 'Use "fimSe" ou "}" para fechar um bloco "se".',
    'fimenquanto': 'Use "fimEnquanto" ou "}" para fechar um laço "enquanto".',
    'fimpara': 'Use "fimPara" ou "}" para fechar um laço "para".',
    'entao': 'Use "entao" ou "{" após a condição do "se".',
    'faca': 'Use "faca" ou "{" após a condição do "enquanto"/"para".',
    'senao': 'Use "senao" para o ramo alternativo.',
  };
  return hints[tokenValue] || '';
}

const ERROR_EXAMPLES: Record<string, string> = {
  'fim': 'se (condicao) entao\n  ...\nfim',
  'fimse': 'se (condicao) entao\n  ...\nfimSe',
  'fimenquanto': 'enquanto (condicao) faca\n  ...\nfimEnquanto',
  'fimpara': 'para (i = 0; i < 10; i = i + 1) faca\n  ...\nfimPara',
  'entao': 'se (condicao) entao\n  ...\nfimSe',
  'faca': 'enquanto (condicao) faca\n  ...\nfimEnquanto',
  'senao': 'se (condicao) entao\n  ...\nsenao\n  ...\nfimSe',
};

function getErrorExample(tokenValue: string): string {
  return ERROR_EXAMPLES[tokenValue] || '';
}

const TYPES = new Set([
  "inteiro", "real", "decimal", "caractere", "texto", "logico",
  "vetor", "matriz", "vazio",
]);
const SENAO = new Set(["senao", "senão"]);
const NAO = new Set(["nao", "não"]);
const ENTACO = new Set(["entao", "então"]);
const FACA = new Set(["faca", "faça"]);
const ATE = new Set(["ate", "até"]);

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) {
      this.pos++;
    }
    return token;
  }

  private expect(type: Token["type"], value?: string): Token {
    const token = this.peek();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      const expected = value ? `${friendlyTokenName(type)} "${value}"` : friendlyTokenName(type);
      const hint = value ? getErrorHint(value) : '';
      const example = value ? getErrorExample(value) : '';
      throw new ParseError(
        token.line,
        `Esperado ${expected}, mas encontrado ${friendlyTokenName(token.type)} "${token.value}"`,
        hint || undefined,
        example || undefined
      );
    }
    return this.advance();
  }

  private skipNewlines(): void {
    while (this.peek().type === "NEWLINE") {
      this.advance();
    }
  }

  private isKeyword(value: string): boolean {
    return this.peek().type === "KEYWORD" && this.peek().value === value;
  }

  private isType(): boolean {
    return this.peek().type === "KEYWORD" && TYPES.has(this.peek().value);
  }

  private isSenao(): boolean {
    return this.peek().type === "KEYWORD" && SENAO.has(this.peek().value);
  }

  private isNao(): boolean {
    return this.peek().type === "KEYWORD" && NAO.has(this.peek().value);
  }

  private isEntaco(): boolean {
    return this.peek().type === "KEYWORD" && ENTACO.has(this.peek().value);
  }

  private isFaca(): boolean {
    return this.peek().type === "KEYWORD" && FACA.has(this.peek().value);
  }

  private isAte(): boolean {
    return this.peek().type === "KEYWORD" && ATE.has(this.peek().value);
  }

  private isEndBlock(): boolean {
    const val = this.peek().value;
    return (
      (this.peek().type === "KEYWORD" &&
        (val === "fim" || val === "fimse" || val === "fimenquanto" || val === "fimpara")) ||
      (this.peek().type === "PUNCTUATION" && val === "}")
    );
  }

  private findMatchingBracket(pos: number): number | null {
    let depth = 0;
    for (let i = pos; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type === "PUNCTUATION" && t.value === "[") depth++;
      if (t.type === "PUNCTUATION" && t.value === "]") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return null;
  }

  // Check if current token looks like a type keyword followed by an identifier (var declaration)
  private looksLikeVarDecl(): boolean {
    if (!this.isType()) return false;
    const next = this.tokens[this.pos + 1];
    return next != null && (next.type === "IDENTIFIER" || next.type === "KEYWORD");
  }

  parse(): ASTNode[] {
    this.skipNewlines();

    // Check for "algori" or "programa" header
    if (this.peek().type === "KEYWORD" && (this.peek().value === "algori" || this.peek().value === "programa")) {
      return this.parseProgramHeader();
    }

    // Top-level code without header
    return this.parseTopLevel();
  }

  private parseProgramHeader(): ASTNode[] {
    this.advance(); // consume "algori" or "programa"

    // Optional program name (string or identifier)
    if (this.peek().type === "STRING" || this.peek().type === "IDENTIFIER") {
      const nameToken = this.peek();
      const name = nameToken.value;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new ParseError(
          nameToken.line,
          `Nome do programa inválido "${name}". Use apenas letras (A-Z), números (0-9) e underscores (_), sem espaços ou caracteres especiais.`
        );
      }
      this.advance();
    }
    this.skipNewlines();

    // Check for "var" block (legacy Algori style)
    if (this.peek().type === "KEYWORD" && this.peek().value === "var") {
      this.advance();
      this.skipNewlines();
      const varDecls = this.parseAlgoriVarBlock();
      this.skipNewlines();
      if (this.isKeyword("inicio")) {
        this.advance();
      }
      const body = this.parseUntilFim();
      return [...varDecls, ...body];
    }

    // Check for "{" block after header
    if (this.peek().type === "PUNCTUATION" && this.peek().value === "{") {
      // Try to detect `programa { funcao inicio() { ... } }` pattern
      const savedPos = this.pos;
      this.advance(); // skip {
      this.skipNewlines();
      if (this.peek().type === "KEYWORD" && this.peek().value === "funcao") {
        this.advance();
        if (this.peek().type === "KEYWORD" && this.peek().value === "inicio") {
          this.advance(); // consume "inicio"
          this.skipNewlines();
          // Skip ()
          if (this.peek().type === "PUNCTUATION" && this.peek().value === "(") {
            this.advance();
            if (this.peek().type === "PUNCTUATION" && this.peek().value === ")") {
              this.advance();
            }
          }
          this.skipNewlines();
          // Parse the body directly
          const body = this.parseBraceBlockOrEmpty();
          // Skip closing }
          this.skipNewlines();
          if (this.peek().type === "PUNCTUATION" && this.peek().value === "}") {
            this.advance();
          }
          return body;
        }
      }
      // Reset and parse as normal brace block
      this.pos = savedPos;
      return this.parseBraceBlock();
    }

    // Legacy: optional "inicio" keyword
    this.skipNewlines();
    if (this.isKeyword("inicio")) {
      this.advance();
      this.skipNewlines();
      // Check for "{" after inicio
      if (this.peek().type === "PUNCTUATION" && this.peek().value === "{") {
        // Check if this is `programa { funcao inicio() { ... } }` pattern
        const savedPos = this.pos;
        this.advance(); // skip {
        this.skipNewlines();
        if (this.peek().type === "KEYWORD" && this.peek().value === "funcao") {
          this.advance();
          if (this.peek().type === "KEYWORD" && this.peek().value === "inicio") {
            this.advance(); // consume "inicio"
            this.skipNewlines();
            // Skip ()
            if (this.peek().type === "PUNCTUATION" && this.peek().value === "(") {
              this.advance();
              if (this.peek().type === "PUNCTUATION" && this.peek().value === ")") {
                this.advance();
              }
            }
            this.skipNewlines();
            // Parse the body directly
            const body = this.parseBraceBlockOrEmpty();
            // Skip closing }
            this.skipNewlines();
            if (this.peek().type === "PUNCTUATION" && this.peek().value === "}") {
              this.advance();
            }
            return body;
          }
        }
        // Reset and parse as normal brace block
        this.pos = savedPos;
        return this.parseBraceBlock();
      }
      // Legacy inicio/fim style
      return this.parseUntilFim();
    }

    // Top-level code: parse statements until EOF
    return this.parseTopLevel();
  }

  private parseTopLevel(): ASTNode[] {
    const statements: ASTNode[] = [];
    while (this.peek().type !== "EOF") {
      statements.push(this.parseStatement());
      this.skipNewlines();
    }
    return statements;
  }

  private parseAlgoriVarBlock(): VarDeclNode[] {
    const decls: VarDeclNode[] = [];
    const baseLine = this.peek().line;

    while (
      this.peek().type !== "EOF" &&
      !(this.peek().type === "KEYWORD" && this.peek().value === "inicio")
    ) {
      this.skipNewlines();
      if (this.peek().type !== "IDENTIFIER") break;

      const names: string[] = [];
      names.push(this.advance().value);

      while (this.peek().type === "PUNCTUATION" && this.peek().value === ",") {
        this.advance();
        if (this.peek().type === "IDENTIFIER") {
          names.push(this.advance().value);
        }
      }

      let typeName: string | null = null;
      if (this.peek().type === "PUNCTUATION" && this.peek().value === ":") {
        this.advance();
        if (this.peek().type === "KEYWORD") {
          typeName = this.advance().value;
        }
      }

      for (const name of names) {
        decls.push({
          kind: "var_decl",
          name,
          typeName,
          expr: { kind: "literal", value: 0, line: baseLine },
          isConstant: false,
          line: baseLine,
        });
      }
    }

    return decls;
  }

  private parseBraceBlock(): ASTNode[] {
    this.expect("PUNCTUATION", "{");
    this.skipNewlines();
    const statements: ASTNode[] = [];
    while (
      this.peek().type !== "EOF" &&
      !(this.peek().type === "PUNCTUATION" && this.peek().value === "}")
    ) {
      statements.push(this.parseStatement());
      this.skipNewlines();
    }
    if (this.peek().type === "PUNCTUATION" && this.peek().value === "}") {
      this.advance();
    }
    return statements;
  }

  private parseUntilFim(): ASTNode[] {
    this.skipNewlines();
    const statements: ASTNode[] = [];
    while (
      this.peek().type !== "EOF" &&
      !(this.peek().type === "KEYWORD" && this.peek().value === "fim")
    ) {
      statements.push(this.parseStatement());
      this.skipNewlines();
    }
    if (this.peek().type === "KEYWORD" && this.peek().value === "fim") {
      this.advance();
    }
    return statements;
  }

  private parseStatement(): ASTNode {
    this.skipNewlines();
    const token = this.peek();

    // Variable declaration with type keyword: inteiro x, inteiro x = 5, texto nome = "ola"
    if (this.looksLikeVarDecl()) {
      return this.parseVarDecl(false);
    }

    // constante
    if (this.peek().type === "KEYWORD" && this.peek().value === "constante") {
      this.advance();
      return this.parseConstDecl();
    }

    // funcao declaration
    if (this.peek().type === "KEYWORD" && this.peek().value === "funcao") {
      return this.parseFunctionDecl();
    }

    // retorne
    if (this.peek().type === "KEYWORD" && this.peek().value === "retorne") {
      return this.parseReturn();
    }

    // pare / continua
    if (this.peek().type === "KEYWORD" && this.peek().value === "pare") {
      const t = this.advance();
      return { kind: "break", line: t.line } as BreakNode;
    }
    if (this.peek().type === "KEYWORD" && this.peek().value === "continua") {
      const t = this.advance();
      return { kind: "continue", line: t.line } as ContinueNode;
    }

    // I/O
    if (this.peek().type === "KEYWORD" && (this.peek().value === "escreva" || this.peek().value === "escrevaln")) {
      return this.parseEscreva();
    }
    if (this.peek().type === "KEYWORD" && this.peek().value === "leia") {
      return this.parseLeia();
    }
    if (this.peek().type === "KEYWORD" && this.peek().value === "mostrar") {
      return this.parsePrint();
    }
    if (this.peek().type === "KEYWORD" && this.peek().value === "capturar") {
      return this.parseInput();
    }
    if (this.peek().type === "KEYWORD" && this.peek().value === "ler") {
      return this.parseInput();
    }

    // Control flow
    if (this.peek().type === "KEYWORD" && this.peek().value === "se") {
      return this.parseIf();
    }
    if (this.peek().type === "KEYWORD" && this.peek().value === "enquanto") {
      return this.parseWhile();
    }
    if (this.peek().type === "KEYWORD" && this.peek().value === "para") {
      return this.parseFor();
    }

    // Identifier or keyword used as variable name: could be assignment, function call, or array access
    if (this.peek().type === "IDENTIFIER" || this.peek().type === "KEYWORD") {
      const next = this.tokens[this.pos + 1];

      // Function call: name(
      if (next && next.type === "PUNCTUATION" && next.value === "(") {
        return this.parseCall();
      }

      // Assignment: name = expr or name <= expr
      if (next && next.type === "OPERATOR" && (next.value === "=" || next.value === "<=")) {
        return this.parseAssign();
      }

      // Array element assignment: name[expr] = expr (possibly multi-dimensional)
      if (next && next.type === "PUNCTUATION" && next.value === "[") {
        let bracketPos = this.pos + 1;
        let afterBracket = this.findMatchingBracket(bracketPos);
        // Skip over chained bracket pairs: name[i][j] = ...
        while (
          afterBracket &&
          afterBracket + 1 < this.tokens.length &&
          this.tokens[afterBracket + 1]?.type === "PUNCTUATION" &&
          this.tokens[afterBracket + 1].value === "["
        ) {
          bracketPos = afterBracket + 1;
          afterBracket = this.findMatchingBracket(bracketPos);
        }
        if (
          afterBracket &&
          this.tokens[afterBracket + 1]?.type === "OPERATOR" &&
          (this.tokens[afterBracket + 1].value === "=" || this.tokens[afterBracket + 1].value === "<=")
        ) {
          return this.parseArrayAssign();
        }
      }
      
      throw new ParseError(
        token.line,
        'Inesperado ' + friendlyTokenName(token.type) + ' "' + token.value + '"',
        getErrorHint(token.value) || undefined,
        getErrorExample(token.value) || undefined
      );
    }

    throw new ParseError(
      token.line,
      'Inesperado ' + friendlyTokenName(token.type) + ' "' + token.value + '"',
      getErrorHint(token.value) || undefined,
      getErrorExample(token.value) || undefined
    );
  }

  private parseVarDecl(isConstant: boolean = false): VarDeclNode {
    const token = this.advance();
    if (!TYPES.has(token.value)) {
      throw new ParseError(token.line, `Tipo inválido '${token.value}'`, 'Tipos válidos: inteiro, real, decimal, caractere, texto, logico, vetor, matriz', 'inteiro x = 0\nreal pi = 3.14\ntexto nome = "Algori"');
    }
    const typeName = token.value;
    const nameToken = this.peek();
    if (nameToken.type !== "IDENTIFIER" && nameToken.type !== "KEYWORD") {
      throw new ParseError(nameToken.line, `Esperado nome de variável, mas encontrado ${friendlyTokenName(nameToken.type)} "${nameToken.value}"`);
    }
    const name = this.advance().value;

    // Array declaration: tipo nome[N] or tipo nome[N][M]
    if (this.peek().type === "PUNCTUATION" && this.peek().value === "[") {
      const dimensions: ExprNode[] = [];
      while (this.peek().type === "PUNCTUATION" && this.peek().value === "[") {
        this.advance();
        dimensions.push(this.parseExpression());
        this.expect("PUNCTUATION", "]");
      }
      if (this.peek().type === "OPERATOR" && this.peek().value === "=") {
        this.advance();
        const expr = this.parseExpression();
        return { kind: "var_decl", name, typeName, expr, isConstant, dimensions, line: token.line };
      }
      return {
        kind: "var_decl",
        name,
        typeName,
        expr: { kind: "array", elements: [], line: token.line },
        isConstant,
        dimensions,
        line: token.line,
      };
    }

    // Inline initialization: tipo nome = expr
    if (this.peek().type === "OPERATOR" && this.peek().value === "=") {
      this.advance();
      const expr = this.parseExpression();
      return { kind: "var_decl", name, typeName, expr, isConstant, line: token.line };
    }

    // Just declaration: tipo nome (default to 0/false/"")
    return {
      kind: "var_decl",
      name,
      typeName,
      expr: { kind: "literal", value: this.defaultValueForType(typeName), line: token.line },
      isConstant,
      line: token.line,
    };
  }

  private defaultValueForType(typeName: string): number | string | boolean | unknown[] {
    return defaultValueForType(typeName);
  }

  private parseConstDecl(): VarDeclNode {
    let typeName: string | null = null;
    if (this.peek().type === "KEYWORD" && TYPES.has(this.peek().value)) {
      typeName = this.advance().value;
    }
    const token = this.expect("IDENTIFIER");
    const name = token.value;
    this.expect("OPERATOR", "=");
    const expr = this.parseExpression();
    return { kind: "var_decl", name, typeName, expr, isConstant: true, line: token.line };
  }

  private parseAssign(): AssignNode {
    const token = this.advance();
    const name = token.value;
    this.expect("OPERATOR", "=");
    const expr = this.parseExpression();
    return { kind: "assign", name, expr, line: token.line };
  }

  private parseArrayAssign(): ArrayAssignNode {
    const token = this.advance();
    const name = token.value;
    const indices: ExprNode[] = [];
    this.expect("PUNCTUATION", "[");
    indices.push(this.parseExpression());
    this.expect("PUNCTUATION", "]");
    while (this.peek().type === "PUNCTUATION" && this.peek().value === "[") {
      this.advance();
      indices.push(this.parseExpression());
      this.expect("PUNCTUATION", "]");
    }
    this.expect("OPERATOR", "=");
    const expr = this.parseExpression();
    return { kind: "array_assign", name, indices, expr, line: token.line };
  }

  private parseArgsInParens(): ExprNode[] {
    this.expect("PUNCTUATION", "(");
    const args: ExprNode[] = [];
    if (this.peek().type !== "PUNCTUATION" || this.peek().value !== ")") {
      args.push(this.parseExpression());
      while (this.peek().type === "PUNCTUATION" && this.peek().value === ",") {
        this.advance();
        args.push(this.parseExpression());
      }
    }
    this.expect("PUNCTUATION", ")");
    return args;
  }

  private parseEscreva(): PrintNode {
    const token = this.advance();
    const args = this.parseArgsInParens();
    return { kind: "print", args, line: token.line };
  }

  private parseLeia(): InputNode {
    const token = this.advance();
    const args = this.parseArgsInParens();
    return { kind: "input", args, line: token.line };
  }

  private parseCall(): CallNode {
    const token = this.advance();
    const callee = token.value;
    const args = this.parseArgsInParens();
    return { kind: "call", callee, args, line: token.line };
  }

  private parsePrint(): PrintNode {
    const token = this.advance();
    const args: ExprNode[] = [];

    // Support both mostrar(...) and mostrar args
    if (this.peek().type === "PUNCTUATION" && this.peek().value === "(") {
      this.advance();
      if (this.peek().type !== "PUNCTUATION" || this.peek().value !== ")") {
        args.push(this.parseExpression());
        while (this.peek().type === "PUNCTUATION" && this.peek().value === ",") {
          this.advance();
          args.push(this.parseExpression());
        }
      }
      this.expect("PUNCTUATION", ")");
    } else if (
      this.peek().type !== "NEWLINE" &&
      this.peek().type !== "EOF" &&
      !this.isEndBlock() &&
      !this.isSenao()
    ) {
      args.push(this.parseExpression());
      while (this.peek().type === "PUNCTUATION" && this.peek().value === ",") {
        this.advance();
        args.push(this.parseExpression());
      }
    }
    return { kind: "print", args, line: token.line };
  }

  private parseInput(): InputNode {
    const token = this.advance();
    const args: ExprNode[] = [];

    // Support both capturar(...) and capturar var
    if (this.peek().type === "PUNCTUATION" && this.peek().value === "(") {
      this.advance();
      if (this.peek().type !== "PUNCTUATION" || this.peek().value !== ")") {
        args.push(this.parseExpression());
      }
      this.expect("PUNCTUATION", ")");
    } else if (
      this.peek().type !== "NEWLINE" &&
      this.peek().type !== "EOF" &&
      !this.isEndBlock()
    ) {
      args.push(this.parseExpression());
    }
    return { kind: "input", args, line: token.line };
  }

  private parseBraceBlockOrEmpty(): ASTNode[] {
    this.skipNewlines();
    if (this.peek().type === "PUNCTUATION" && this.peek().value === "{") {
      return this.parseBraceBlock();
    }
    // Single statement without braces
    return [this.parseStatement()];
  }

  private parseIf(): IfNode {
    const token = this.advance();
    const condition = this.parseExpression();
    this.skipNewlines();
    if (this.isEntaco()) {
      this.advance();
    }
    this.skipNewlines();

    // Parse then branch
    const thenBranch = this.parseBraceBlockOrEmpty();

    // Parse else / else if chains
    let elseBranch: ASTNode[] | null = null;

    this.skipNewlines();
    if (this.isSenao()) {
      this.advance();
      this.skipNewlines();

      // Check for "senao se" (else if)
      if (this.peek().type === "KEYWORD" && this.peek().value === "se") {
        // Build nested if for else-if chains
        const elseIfIf = this.parseIf();
        elseBranch = [elseIfIf];
      } else {
        elseBranch = this.parseBraceBlockOrEmpty();
      }
    }

    // Legacy: check for fimse/fim
    if (!this.peek() || this.peek().type === "EOF") {
      // ok
    } else if (
      this.peek().type === "KEYWORD" &&
      (this.peek().value === "fimse" || this.peek().value === "fim")
    ) {
      this.advance();
    }

    return {
      kind: "if",
      branches: [{ condition, body: thenBranch }],
      elseBranch,
      line: token.line,
    };
  }

  private parseWhile(): WhileNode {
    const token = this.advance();
    const condition = this.parseExpression();
    this.skipNewlines();
    if (this.isFaca()) {
      this.advance();
    }
    this.skipNewlines();

    const body = this.parseBraceBlockOrEmpty();

    // Legacy: check for fimenquanto/fim
    if (
      this.peek().type === "KEYWORD" &&
      (this.peek().value === "fimenquanto" || this.peek().value === "fim")
    ) {
      this.advance();
    }

    return { kind: "while", condition, body, line: token.line };
  }

  private parseFor(): ForNode {
    const token = this.advance();
    this.skipNewlines();

    // C-style: para (inteiro i = 0; i < 10; i = i + 1) { ... }
    // Or legacy: para i de 0 ate 10 { ... }
    if (this.peek().type === "PUNCTUATION" && this.peek().value === "(") {
      return this.parseForCStyle(token);
    }

    // Legacy: para nome de start ate end [passo step]
    const varName = this.expect("IDENTIFIER").value;
    this.expect("KEYWORD", "de");
    const start = this.parseExpression();
    if (this.isAte()) {
      this.advance();
    } else {
      this.expect("KEYWORD", "ate");
    }
    const end = this.parseExpression();
    let step: ExprNode | null = null;
    if (this.peek().type === "KEYWORD" && this.peek().value === "passo") {
      this.advance();
      step = this.parseExpression();
    }
    this.skipNewlines();
    if (this.isFaca()) {
      this.advance();
    }
    this.skipNewlines();

    const body = this.parseBraceBlockOrEmpty();

    // Legacy: check for fimpara/fim
    if (
      this.peek().type === "KEYWORD" &&
      (this.peek().value === "fimpara" || this.peek().value === "fim")
    ) {
      this.advance();
    }

    return { kind: "for", varName, start, end, step, body, condition: null, update: null, line: token.line };
  }

  private parseForCStyle(paraToken: Token): ForNode {
    // para (init; cond; update) { body }
    this.expect("PUNCTUATION", "(");
    this.skipNewlines();

    // init: either "tipo var = expr" or "var = expr"
    let varName: string;
    let start: ExprNode;
    const initLine = this.peek().line;

    if (this.isType()) {
      // tipo var = expr
      this.advance(); // skip type
      varName = this.expect("IDENTIFIER").value;
      this.expect("OPERATOR", "=");
      start = this.parseExpression();
    } else {
      varName = this.expect("IDENTIFIER").value;
      this.expect("OPERATOR", "=");
      start = this.parseExpression();
    }

    this.expect("PUNCTUATION", ";");
    this.skipNewlines();

    // condition
    const condition = this.parseExpression();

    this.expect("PUNCTUATION", ";");
    this.skipNewlines();

    // update: var = expr
    const updateVar = this.expect("IDENTIFIER").value;
    this.expect("OPERATOR", "=");
    const updateExpr = this.parseExpression();

    this.expect("PUNCTUATION", ")");
    this.skipNewlines();

    // Consume "faca" keyword if present
    if (this.isKeyword("faca")) {
      this.advance();
    }

    // Build body WITHOUT update injected
    const body = this.parseBraceBlockOrEmpty();

    // Legacy: check for fimpara/fim
    this.skipNewlines();
    if (
      this.peek().type === "KEYWORD" &&
      (this.peek().value === "fimpara" || this.peek().value === "fim")
    ) {
      this.advance();
    }

    // Create a separate update node
    const update: AssignNode = {
      kind: "assign",
      name: updateVar,
      expr: updateExpr,
      line: initLine,
    };

    return { kind: "for", varName, start, end: condition, step: null, condition, update, body, line: paraToken.line };
  }

  private parseFunctionDecl(): FunctionDeclNode {
    const token = this.advance(); // skip "funcao"
    this.skipNewlines();

    // Return type: optional
    let returnType: string | null = null;
    if (this.isType() && this.peek().value !== "vazio") {
      returnType = this.advance().value;
    } else if (this.peek().type === "KEYWORD" && this.peek().value === "vazio") {
      returnType = this.advance().value;
    }

    // Function name (keywords like "inicio" are allowed as function names)
    let funcName: string;
    if (this.peek().type === "IDENTIFIER") {
      funcName = this.advance().value;
    } else if (this.peek().type === "KEYWORD") {
      funcName = this.advance().value;
    } else {
      throw new ParseError(
        this.peek().line,
        `Esperado nome de função, mas encontrado ${friendlyTokenName(this.peek().type)} "${this.peek().value}"`,
        'Use um nome válido para a função.',
        'funcao minhaFuncao()\n  ...\nfim'
      );
    }

    // Parameters: (tipo nome, tipo nome, ...)
    this.expect("PUNCTUATION", "(");
    const params: FunctionParam[] = [];
    if (this.peek().type !== "PUNCTUATION" || this.peek().value !== ")") {
      // Look ahead: is this "tipo nome" or just "nome"?
      if (this.isType()) {
        const paramType = this.advance().value;
        const paramName = this.expect("IDENTIFIER").value;
        params.push({ name: paramName, typeName: paramType });
      } else {
        const paramName = this.expect("IDENTIFIER").value;
        params.push({ name: paramName, typeName: null });
      }
      while (this.peek().type === "PUNCTUATION" && this.peek().value === ",") {
        this.advance();
        if (this.isType()) {
          const paramType = this.advance().value;
          const paramName = this.expect("IDENTIFIER").value;
          params.push({ name: paramName, typeName: paramType });
        } else {
          const paramName = this.expect("IDENTIFIER").value;
          params.push({ name: paramName, typeName: null });
        }
      }
    }
    this.expect("PUNCTUATION", ")");
    this.skipNewlines();

    // Body
    const body = this.parseBraceBlockOrEmpty();

    // Legacy: check for fimfuncao/fim
    if (
      this.peek().type === "KEYWORD" &&
      (this.peek().value === "fimfuncao" || this.peek().value === "fim")
    ) {
      this.advance();
    }

    return { kind: "function_decl", name: funcName, returnType, params, body, line: token.line };
  }

  private parseReturn(): ReturnNode {
    const token = this.advance(); // skip "retorne"
    this.skipNewlines();

    // Check if there's an expression to return
    if (
      this.peek().type === "NEWLINE" ||
      this.peek().type === "EOF" ||
      this.isEndBlock() ||
      (this.peek().type === "PUNCTUATION" && this.peek().value === "}")
    ) {
      return { kind: "return", expr: null, line: token.line };
    }

    const expr = this.parseExpression();
    return { kind: "return", expr, line: token.line };
  }

  private parseExpression(): ExprNode {
    return this.parseOr();
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (
      (this.peek().type === "KEYWORD" && this.peek().value === "ou") ||
      (this.peek().type === "OPERATOR" && this.peek().value === "||")
    ) {
      const op = this.advance();
      const right = this.parseAnd();
      left = { kind: "binop", op: "||", left, right, line: op.line };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseComparison();
    while (
      (this.peek().type === "KEYWORD" && this.peek().value === "e") ||
      (this.peek().type === "OPERATOR" && this.peek().value === "&&")
    ) {
      const op = this.advance();
      const right = this.parseComparison();
      left = { kind: "binop", op: "&&", left, right, line: op.line };
    }
    return left;
  }

  private parseComparison(): ExprNode {
    let left = this.parseAddSub();
    const op = this.peek();
    if (
      op.type === "OPERATOR" &&
      (op.value === "==" ||
        op.value === "!=" ||
        op.value === "<" ||
        op.value === ">" ||
        op.value === "<=" ||
        op.value === ">=")
    ) {
      this.advance();
      const right = this.parseAddSub();
      left = { kind: "binop", op: op.value, left, right, line: op.line };
    }
    return left;
  }

  private parseAddSub(): ExprNode {
    let left = this.parseMulDivMod();
    while (
      this.peek().type === "OPERATOR" &&
      (this.peek().value === "+" || this.peek().value === "-")
    ) {
      const op = this.advance();
      const right = this.parseMulDivMod();
      left = { kind: "binop", op: op.value, left, right, line: op.line };
    }
    return left;
  }

  private parseMulDivMod(): ExprNode {
    let left = this.parseUnary();
    while (
      (this.peek().type === "OPERATOR" &&
        (this.peek().value === "*" ||
          this.peek().value === "/" ||
          this.peek().value === "%")) ||
      (this.peek().type === "KEYWORD" &&
        (this.peek().value === "mod" || this.peek().value === "div"))
    ) {
      const op = this.advance();
      const mappedOp = op.value === "mod" ? "%" : op.value;
      const right = this.parseUnary();
      left = { kind: "binop", op: mappedOp, left, right, line: op.line };
    }
    return left;
  }

  private parseUnary(): ExprNode {
    const token = this.peek();
    if (token.type === "OPERATOR" && token.value === "-") {
      this.advance();
      const operand = this.parseUnary();
      return { kind: "unaryop", op: "-", operand, line: token.line };
    }
    if (token.type === "OPERATOR" && token.value === "!") {
      this.advance();
      const operand = this.parseUnary();
      return { kind: "unaryop", op: "!", operand, line: token.line };
    }
    if (this.isNao()) {
      this.advance();
      const operand = this.parseUnary();
      return { kind: "unaryop", op: "!", operand, line: token.line };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExprNode {
    let expr = this.parsePrimary();
    if (expr.kind === "identifier") {
      const indices: ExprNode[] = [];
      while (
        this.peek().type === "PUNCTUATION" && this.peek().value === "["
      ) {
        this.advance();
        indices.push(this.parseExpression());
        this.expect("PUNCTUATION", "]");
      }
      if (indices.length > 0) {
        return {
          kind: "array_access",
          name: expr.name,
          indices,
          line: expr.line,
        };
      }
    }
    return expr;
  }

  private parsePrimary(): ExprNode {
    const token = this.peek();

    if (token.type === "NUMBER") {
      this.advance();
      return {
        kind: "literal",
        value: Number(token.value),
        line: token.line,
      };
    }

    if (token.type === "STRING") {
      this.advance();
      if (token.value === "true") {
        return { kind: "literal", value: true, line: token.line };
      }
      if (token.value === "false") {
        return { kind: "literal", value: false, line: token.line };
      }
      return { kind: "literal", value: token.value, line: token.line };
    }

    if (token.type === "IDENTIFIER") {
      this.advance();
      if (
        this.peek().type === "PUNCTUATION" &&
        this.peek().value === "("
      ) {
        const callee = token.value;
        this.advance();
        const args: ExprNode[] = [];
        if (
          this.peek().type !== "PUNCTUATION" ||
          this.peek().value !== ")"
        ) {
          args.push(this.parseExpression());
          while (
            this.peek().type === "PUNCTUATION" &&
            this.peek().value === ","
          ) {
            this.advance();
            args.push(this.parseExpression());
          }
        }
        this.expect("PUNCTUATION", ")");
        return { kind: "call_expr", callee, args, line: token.line } as CallExprNode;
      }
      return { kind: "identifier", name: token.value, line: token.line };
    }

    // Keywords used as variable names (e.g., vetor[i])
    if (token.type === "KEYWORD" && TYPES.has(token.value)) {
      this.advance();
      return { kind: "identifier", name: token.value, line: token.line };
    }

    // capturar() and ler() as expressions (return call_expr for use in assignments)
    if (token.type === "KEYWORD" && (token.value === "capturar" || token.value === "ler")) {
      this.advance();
      if (this.peek().type === "PUNCTUATION" && this.peek().value === "(") {
        this.advance();
        const args: ExprNode[] = [];
        if (this.peek().type !== "PUNCTUATION" || this.peek().value !== ")") {
          args.push(this.parseExpression());
        }
        this.expect("PUNCTUATION", ")");
        return { kind: "call_expr", callee: token.value, args, line: token.line } as CallExprNode;
      }
      // capturar without parentheses - return call_expr with no args
      return { kind: "call_expr", callee: token.value, args: [], line: token.line } as CallExprNode;
    }

    if (token.type === "PUNCTUATION" && token.value === "(") {
      this.advance();
      const expr = this.parseExpression();
      this.expect("PUNCTUATION", ")");
      return expr;
    }

    if (token.type === "PUNCTUATION" && token.value === "[") {
      return this.parseArrayLiteral();
    }

    // Handle conditional expression: se (condition) { thenBranch } senao { elseBranch }
    if (token.type === "KEYWORD" && token.value === "se") {
      this.advance();
      this.skipNewlines();
      
      // Parse condition
      if (this.peek().type === "PUNCTUATION" && this.peek().value === "(") {
        this.advance();
        const condition = this.parseExpression();
        this.expect("PUNCTUATION", ")");
        this.skipNewlines();
        
        // Parse then branch
        this.expect("PUNCTUATION", "{");
        const thenBranch = this.parseExpression();
        this.expect("PUNCTUATION", "}");
        this.skipNewlines();
        
        // Parse else branch (optional for inline conditional)
        let elseBranch: ExprNode | null = null;
        if (this.isSenao()) {
          this.advance();
          this.skipNewlines();
          this.expect("PUNCTUATION", "{");
          elseBranch = this.parseExpression();
          this.expect("PUNCTUATION", "}");
        }
        return {
          kind: "conditional_expr",
          condition,
          thenBranch,
          elseBranch,
          line: token.line,
        };
      }
      
      throw new ParseError(
        token.line,
        'Expressão condicional inválida. Use: se (condição) { valor } ou se (condição) { valor } senao { valor }'
      );
    }

    const errToken = this.peek();
    throw new ParseError(
      errToken.line,
      `Inesperado ${friendlyTokenName(errToken.type)} "${errToken.value}"`,
      getErrorHint(errToken.value) || undefined,
      getErrorExample(errToken.value) || undefined
    );
  }

  private parseArrayLiteral(): ArrayNode {
    const token = this.advance();
    const elements: ExprNode[] = [];
    if (this.peek().type !== "PUNCTUATION" || this.peek().value !== "]") {
      elements.push(this.parseExpression());
      while (this.peek().type === "PUNCTUATION" && this.peek().value === ",") {
        this.advance();
        if (this.peek().type === "PUNCTUATION" && this.peek().value === "]") {
          break;
        }
        elements.push(this.parseExpression());
      }
    }
    this.expect("PUNCTUATION", "]");
    return { kind: "array", elements, line: token.line };
  }
}

/**
 * Parses tokens into an Abstract Syntax Tree (AST).
 *
 * Implements syntax analysis with recursive descent, validating:
 * - General program structure (algori/programa, declarations, functions)
 * - Variable and constant declarations
 * - Expressions and operators
 * - Control structures (if/else, while, for)
 * - Functions and function calls
 * - Arrays and array indexing
 *
 * @param {Token[]} tokens - Array of tokens from the tokenizer
 * @returns {ASTNode[]} Array of nodes that form the program
 * @throws {ParseError} If there is a syntax error
 * @throws {ParseError} If there is an unexpected token
 * @throws {ParseError} If there is invalid syntax or unclosed blocks
 *
 * @example
 * const code = 'algori "test"\nmostrar(42)';
 * const tokens = tokenize(code);
 * const ast = parse(tokens);
 * // ast contains the AST nodes for execution
 */
export function parse(tokens: Token[]): ASTNode[] {
  const parser = new Parser(tokens);
  return parser.parse();
}
