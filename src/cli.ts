#!/usr/bin/env bun

import { tokenize } from "./tokenizer.js";
import { parse } from "./parser.js";
import { Interpreter, InputRequestError } from "./interpreter.js";
import { ParseError, RuntimeError } from "./errors.js";
import * as fs from "fs";
import * as path from "path";

const VERSION = "1.1.1";
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const VALID_EXTENSIONS = [".algori", ".algx"];

function isValidAlgoriFile(filePath: string): boolean {
  return VALID_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function resolveFilePath(input: string): string {
  const resolved = path.resolve(input);
  if (fs.existsSync(resolved) && isValidAlgoriFile(resolved)) {
    return resolved;
  }
  for (const ext of VALID_EXTENSIONS) {
    const withExt = resolved + ext;
    if (fs.existsSync(withExt)) {
      return withExt;
    }
  }
  return resolved;
}

function printHelp() {
  console.log(`
Algori v${VERSION} — Linguagem de programação em português

Uso:
  algori executar <arquivo>           Executar um programa (.algori ou .algx)
  algori novo [nome]                 Criar um novo programa
  algori ajuda                       Mostrar esta ajuda
  algori versao                      Mostrar versão
  algori atualizar                   Verificar e instalar atualização

  algori <arquivo>                   Executar (atalho legado)

Flags:
  --debug                            Ativar modo debug (mostra cada instrução)
  --timeout <ms>                     Tempo máximo de execução em ms (padrão: 0 = desligado)
  --max-recursion <n>                Limite máximo de recursão (padrão: 100)
  --max-loop-iterations <n>          Limite máximo de iterações por loop (padrão: 10000)
  --max-iter <n>                     Limite máximo de passos totais (padrão: 1000000)
  --help, -h                         Mostrar esta ajuda
  --version, -v                      Mostrar versão

Exemplos:
  algori executar meuprograma
  algori executar meuprograma.algori --debug
  algori executar meuprograma.algori --timeout 5000
  algori executar meuprograma.algori --max-recursion 50
  algori novo ola_mundo
  algori ajuda
`);
}

function printVersion() {
  console.log(`Algori v${VERSION}`);
}

function createNewProject(name: string) {
  const dir = path.resolve(name);
  if (fs.existsSync(dir)) {
    console.error(`Erro: Pasta "${name}" já existe.`);
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.algori`);
  const content = `programa ${name}

mostrar("Olá, ${name}!")
`;
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`Programa "${name}" criado em: ${filePath}`);
  console.log(`Execute com: algori executar ${name}/${name}.algori`);
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

function detectPlatform(): string {
  const os = process.platform;
  const arch = process.arch;
  const osName =
    os === "darwin" ? "macos" : os === "win32" ? "windows" : "linux";
  const archName = arch === "arm64" ? "arm64" : "x64";
  return `${osName}-${archName}`;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/wanfranklin/algori/releases/latest",
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    return data.tag_name?.replace(/^v/, "") ?? null;
  } catch {
    return null;
  }
}

async function runUpdate() {
  const platform = detectPlatform();
  console.log(`Versão atual: v${VERSION}`);
  console.log("Verificando atualizações...");

  const latest = await fetchLatestVersion();
  if (!latest) {
    console.error("Erro: Não foi possível verificar a versão mais recente.");
    console.error("Verifique sua conexão com a internet.");
    process.exit(1);
  }

  console.log(`Versão mais recente: v${latest}`);

  if (compareVersions(latest, VERSION) <= 0) {
    console.log("Você já está na versão mais recente!");
    return;
  }

  console.log(`\nAtualizando de v${VERSION} para v${latest}...`);

  const filename = `algori-${platform}`;
  const url = `https://github.com/wanfranklin/algori/releases/download/v${latest}/${filename}`;

  const currentBin = process.argv[1];
  const isWindows = process.platform === "win32";
  const tmpFile = `${currentBin}.tmp`;

  try {
    const { execSync } = await import("child_process");
    if (isWindows) {
      execSync(
        `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${tmpFile}'"`,
        { stdio: "inherit" },
      );
      execSync(`move /Y "${tmpFile}" "${currentBin}"`, { stdio: "inherit" });
    } else {
      execSync(`curl -fsSL -o "${tmpFile}" "${url}"`, { stdio: "inherit" });
      execSync(`chmod +x "${tmpFile}"`, { stdio: "inherit" });
      execSync(`mv "${tmpFile}" "${currentBin}"`, { stdio: "inherit" });
    }
    console.log(`\nAtualizado com sucesso para v${latest}!`);
  } catch {
    console.error("Erro ao baixar ou instalar a atualização.");
    try {
      const fs = await import("fs");
      fs.unlinkSync(tmpFile);
    } catch {}
    process.exit(1);
  }
}

async function readLine(prompt: string): Promise<string> {
  const stdin = process.stdin;
  stdin.setRawMode?.(false);
  stdin.resume();
  stdin.setEncoding("utf-8");

  process.stdout.write(prompt);

  return new Promise<string>((resolve) => {
    stdin.once("data", (data: string) => {
      resolve(data.trim());
    });
    stdin.once("end", () => {
      resolve("");
    });
  });
}

interface RunOptions {
  debugMode?: boolean;
  timeoutMs?: number;
  maxRecursion?: number;
  maxLoopIterations?: number;
  maxIterations?: number;
}

async function runFile(filePath: string, options: RunOptions = {}) {
  if (!fs.existsSync(filePath)) {
    console.error(`Erro: Arquivo "${filePath}" não encontrado.`);
    process.exit(1);
  }

  if (!isValidAlgoriFile(filePath)) {
    console.error(
      `Erro: Arquivo deve ter extensão ${VALID_EXTENSIONS.join(" ou ")}`,
    );
    process.exit(1);
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    console.error(
      `Erro: Arquivo muito grande (${Math.round(stat.size / 1024)}KB). Limite: 1MB.`,
    );
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf-8");

  const tokens = tokenize(code);

  let ast;
  try {
    ast = parse(tokens);
  } catch (err) {
    console.error(formatError(err as Error));
    process.exit(1);
  }

  const interpreter = new Interpreter({
    debugMode: options.debugMode,
    timeoutMs: options.timeoutMs,
    maxCallStackDepth: options.maxRecursion,
    maxLoopIterations: options.maxLoopIterations,
    maxIterations: options.maxIterations,
  });

  try {
    interpreter.run(ast, code);
  } catch (err) {
    if (err instanceof InputRequestError) {
      const resumeIndex = interpreter.currentExecIndex;
      await handleInput(interpreter, ast, err, resumeIndex);
    } else {
      console.error(formatError(err as Error));
      process.exit(1);
    }
  }

  printOutput(interpreter);
}

async function handleInput(
  interpreter: Interpreter,
  ast: ReturnType<typeof parse>,
  err: InputRequestError,
  resumeIndex: number = 0,
) {
  printOutput(interpreter);

  const input = await readLine(err.prompt);
  const parts = input.split(/[,;]/).map((v) => v.trim());

  if (err.args && err.args.length > 0) {
    err.args.forEach((varName: string, i: number) => {
      if (varName) {
        const raw = parts[i] ?? "";
        let parsed: unknown = raw;

        if (raw === "verdadeiro" || raw === "true") parsed = true;
        else if (raw === "falso" || raw === "false") parsed = false;
        else if (!isNaN(Number(raw)) && raw !== "") parsed = Number(raw);

        interpreter.variables.set(varName, parsed);
      }
    });
  }

  const rawValue = parts[0] ?? "";

  let parsedValue: unknown = rawValue;

  if (rawValue === "verdadeiro" || rawValue === "true") {
    parsedValue = true;
  } else if (rawValue === "falso" || rawValue === "false") {
    parsedValue = false;
  } else if (rawValue !== "" && !isNaN(Number(rawValue))) {
    parsedValue = Number(rawValue);
  }

  interpreter.inputResolved = true;
  interpreter.lastInputValue = parsedValue;

  try {
    interpreter.execBlockFrom(ast, resumeIndex);
  } catch (e) {
    if (e instanceof InputRequestError) {
      const nextIndex = interpreter.currentExecIndex;
      await handleInput(interpreter, ast, e, nextIndex);
    } else {
      throw e;
    }
  }
}

function printOutput(interpreter: Interpreter) {
  for (const line of interpreter.console) {
    if (line.type === "output" || line.type === "input") {
      process.stdout.write(line.text + "\n");
    }
  }
}

function formatError(err: Error): string {
  if (err instanceof ParseError || err instanceof RuntimeError) {
    return err.format();
  }
  const msg = err.message;
  const parts = msg.split("|||");
  if (parts.length === 1) return msg;

  let output = parts[0];
  if (parts[1]) {
    output += `\n  Código: ${parts[1]}`;
  }
  if (parts[2]) {
    output += `\n  Dica: ${parts[2]}`;
  }
  if (parts[3]) {
    output += `\n  Exemplo:\n    ${parts[3].replace(/\n/g, "\n    ")}`;
  }
  return output;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function extractRunOptions(args: string[]): {
  file: string | null;
  options: RunOptions;
} {
  let file: string | null = null;
  const options: RunOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--debug") {
      options.debugMode = true;
    } else if (arg === "--timeout") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options.timeoutMs = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--max-recursion") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options.maxRecursion = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--max-loop-iterations") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options.maxLoopIterations = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--max-iter") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options.maxIterations = parseInt(next, 10);
        i++;
      }
    } else if (!arg.startsWith("--") && !file) {
      file = arg;
    }
  }

  return { file, options };
}

const args = process.argv.slice(2);
const subcommands: Record<string, string> = {
  executar: "executar",
  exec: "executar",
  rodar: "executar",
  run: "executar",
  novo: "novo",
  "new": "novo",
  criar: "novo",
  create: "novo",
  ajuda: "ajuda",
  help: "ajuda",
  versao: "versao",
  version: "versao",
  atualizar: "atualizar",
  update: "atualizar",
};

// Sem argumentos: mostrar ajuda
if (args.length === 0) {
  printHelp();
  process.exit(0);
}

const first = args[0].toLowerCase();

// Flags de legado (--help, --version, etc.)
if (first === "--help" || first === "-h") {
  printHelp();
  process.exit(0);
}
if (first === "--version" || first === "--versao" || first === "-v") {
  printVersion();
  process.exit(0);
}
if (first === "--update" || first === "--atualizar") {
  await runUpdate();
  process.exit(0);
}

// Subcomandos em português
const mapped = subcommands[first];
if (mapped) {
  switch (mapped) {
    case "executar": {
      const { file, options } = extractRunOptions(args.slice(1));
      if (!file) {
        console.error("Erro: Informe o arquivo para executar.");
        console.error(
          "Uso: algori executar <arquivo> [--debug] [--timeout <ms>]",
        );
        process.exit(1);
      }
      await runFile(resolveFilePath(file), options);
      break;
    }
    case "novo": {
      const name = args[1] || "meu_programa";
      createNewProject(name);
      break;
    }
    case "ajuda":
      printHelp();
      break;
    case "versao":
      printVersion();
      break;
    case "atualizar":
      await runUpdate();
      break;
  }
  process.exit(0);
}

// Legado: algori <arquivo.algori> direto
const { file, options } = extractRunOptions(args);
if (file) {
  await runFile(resolveFilePath(file), options);
}
