#!/usr/bin/env node
import { scanProject } from "./project/index.js";
import type { AnalysisTrace } from "./static-analysis-engine/index.js";
import type { Finding, RuleSeverity } from "./rules/index.js";
import type { ScanDiagnostic, ScanProjectResult } from "./project/index.js";
import { severityMeetsThreshold } from "./rules/severity.js";

type CliArgs = {
  rootDir?: string;
  configPath?: string;
  focusPaths: string[];
  json: boolean;
  trace: boolean;
  help: boolean;
};

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const PLANNED_BUT_UNSUPPORTED_FLAGS = new Set([
  "--output-file",
  "--overwrite-output",
  "--print-config",
  "--verbosity",
  "--output-min-severity",
]);

let args: CliArgs;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  if (error instanceof CliUsageError) {
    console.error(error.message);
    console.error("");
    printHelp(process.stderr);
    process.exit(2);
  }

  throw error;
}

if (args.help) {
  printHelp();
  process.exit(0);
}

const result = await scanProject({
  rootDir: args.rootDir,
  configPath: args.configPath,
});
const focusedResult = applyFocusFilter(result, args.focusPaths);

if (args.json) {
  console.log(JSON.stringify(formatJsonResult(focusedResult, args.trace), null, 2));
} else {
  const visibleDiagnostics = filterDiagnostics(focusedResult.diagnostics, args.trace);
  const visibleFindings = filterFindings(focusedResult.findings, args.trace);

  console.log(`scan-react-css reboot scan`);
  console.log(`Root: ${focusedResult.rootDir}`);
  if (args.focusPaths.length > 0) {
    console.log(`Focus: ${args.focusPaths.join(", ")}`);
  }
  console.log(`Source files: ${focusedResult.summary.sourceFileCount}`);
  console.log(`CSS files: ${focusedResult.summary.cssFileCount}`);
  console.log(`Findings: ${visibleFindings.length}`);
  console.log(`Failed: ${focusedResult.failed ? "yes" : "no"}`);
  console.log(`Fail on severity: ${focusedResult.config.failOnSeverity}`);
  console.log(`Class references: ${focusedResult.summary.classReferenceCount}`);
  console.log(`Class definitions: ${focusedResult.summary.classDefinitionCount}`);
  console.log(`Selector queries: ${focusedResult.summary.selectorQueryCount}`);

  for (const diagnostic of visibleDiagnostics) {
    console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
  }

  for (const finding of visibleFindings) {
    const location = finding.location
      ? ` (${finding.location.filePath}:${finding.location.startLine})`
      : "";
    console.log(`[${finding.severity}] ${finding.ruleId}: ${finding.message}${location}`);
    if (args.trace) {
      for (const trace of finding.traces) {
        printTrace(trace, "  ");
      }
    }
  }
}

process.exit(focusedResult.failed ? 1 : 0);

function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = {
    focusPaths: [],
    json: false,
    trace: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--config") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--config requires a path value.");
      }

      args.configPath = value;
      index += 1;
      continue;
    }

    if (arg === "--focus") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--focus requires a path or glob value.");
      }

      args.focusPaths.push(...parseFocusValues(value));
      index += 1;
      continue;
    }

    if (arg === "--trace" || arg === "--debug") {
      args.trace = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (PLANNED_BUT_UNSUPPORTED_FLAGS.has(arg)) {
      throw new CliUsageError(`${arg} is recognized, but is not supported in this build yet.`);
    }

    if (arg.startsWith("-")) {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }

    if (!args.rootDir) {
      args.rootDir = arg;
      continue;
    }

    throw new CliUsageError(`Unexpected positional argument: ${arg}`);
  }

  return args;
}

function printHelp(stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(
    `Usage: scan-react-css [rootDir] [--config path] [--focus path-or-glob] [--json] [--trace]\n`,
  );
}

function formatJsonResult(result: ScanProjectResult, includeDebug: boolean): object {
  return {
    rootDir: result.rootDir,
    config: {
      source: result.config.source,
      failOnSeverity: result.config.failOnSeverity,
      rules: result.config.rules,
    },
    diagnostics: filterDiagnostics(result.diagnostics, includeDebug),
    findings: filterFindings(result.findings, includeDebug),
    summary: includeDebug ? result.summary : withoutDebugCounts(result.summary),
    failed: result.failed,
  };
}

function applyFocusFilter(result: ScanProjectResult, focusPaths: string[]): ScanProjectResult {
  if (focusPaths.length === 0) {
    return result;
  }

  const matchers = focusPaths.map((focusPath) => buildFocusMatcher(focusPath, result.rootDir));
  const findings = result.findings.filter((finding) => findingMatchesFocus(finding, matchers));
  const failed =
    result.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    findings.some((finding) =>
      severityMeetsThreshold(finding.severity, result.config.failOnSeverity),
    );

  return {
    ...result,
    findings,
    failed,
    summary: {
      ...result.summary,
      findingCount: findings.length,
      findingsBySeverity: {
        debug: countFindingsBySeverity(findings, "debug"),
        info: countFindingsBySeverity(findings, "info"),
        warn: countFindingsBySeverity(findings, "warn"),
        error: countFindingsBySeverity(findings, "error"),
      },
      failed,
    },
  };
}

type FocusMatcher = (filePath: string) => boolean;

function findingMatchesFocus(finding: Finding, matchers: FocusMatcher[]): boolean {
  const candidatePaths = collectFindingPaths(finding);
  return candidatePaths.some((filePath) => matchers.some((matcher) => matcher(filePath)));
}

function collectFindingPaths(finding: Finding): string[] {
  const paths = new Set<string>();
  if (finding.location) {
    paths.add(finding.location.filePath);
  }

  for (const entity of [finding.subject, ...finding.evidence]) {
    const entityPath = extractPathFromEntityId(entity.id);
    if (entityPath) {
      paths.add(entityPath);
    }
  }

  for (const trace of finding.traces) {
    collectTracePaths(trace, paths);
  }

  return [...paths];
}

function collectTracePaths(trace: AnalysisTrace, paths: Set<string>): void {
  if (trace.anchor) {
    paths.add(trace.anchor.filePath);
  }

  for (const child of trace.children) {
    collectTracePaths(child, paths);
  }
}

function extractPathFromEntityId(entityId: string): string | undefined {
  const pathPrefixes = [
    "source:",
    "stylesheet:",
    "class-reference:",
    "unsupported-class-reference:",
    "class-definition:",
    "selector-query:",
    "selector-branch:",
    "component:",
    "render-subtree:",
    "css-module-import:",
    "css-module-member-reference:",
    "css-module-reference-diagnostic:",
  ];

  for (const prefix of pathPrefixes) {
    if (!entityId.startsWith(prefix)) {
      continue;
    }

    const withoutPrefix = entityId.slice(prefix.length);
    const extensionMatch = /\.(?:[cm]?[jt]sx?|css)(?::|$)/i.exec(withoutPrefix);
    if (!extensionMatch) {
      return undefined;
    }

    const matchedExtension = extensionMatch[0].replace(/:$/, "");
    return withoutPrefix.slice(0, extensionMatch.index + matchedExtension.length);
  }

  return undefined;
}

function parseFocusValues(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildFocusMatcher(focusPath: string, rootDir: string): FocusMatcher {
  const normalizedFocusPath = normalizeFocusPath(focusPath, rootDir);
  if (normalizedFocusPath === ".") {
    return () => true;
  }

  if (hasGlobSyntax(normalizedFocusPath)) {
    const pattern = globToRegExp(normalizedFocusPath);
    return (filePath) => pattern.test(normalizeProjectPath(filePath));
  }

  return (filePath) => {
    const normalizedFilePath = normalizeProjectPath(filePath);
    return (
      normalizedFilePath === normalizedFocusPath ||
      normalizedFilePath.startsWith(`${normalizedFocusPath}/`)
    );
  };
}

function normalizeFocusPath(focusPath: string, rootDir: string): string {
  let normalized = normalizeProjectPath(focusPath);
  const normalizedRoot = normalizeProjectPath(rootDir);
  if (normalized === normalizedRoot) {
    return ".";
  }

  if (normalized.startsWith(`${normalizedRoot}/`)) {
    normalized = normalized.slice(normalizedRoot.length + 1);
  }

  return normalized.replace(/^\.\/+/, "").replace(/\/+$/, "") || ".";
}

function normalizeProjectPath(filePath: string): string {
  return filePath.split("\\").join("/").replace(/\/+/g, "/").replace(/\/+$/, "");
}

function hasGlobSyntax(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const nextChar = glob[index + 1];

    if (char === "*" && nextChar === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  source += "(?:/.*)?$";
  return new RegExp(source);
}

function countFindingsBySeverity(findings: Finding[], severity: RuleSeverity): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filterDiagnostics(diagnostics: ScanDiagnostic[], includeDebug: boolean): ScanDiagnostic[] {
  return includeDebug
    ? diagnostics
    : diagnostics.filter((diagnostic) => diagnostic.severity !== "debug");
}

function filterFindings(findings: Finding[], includeDebug: boolean): Finding[] {
  return includeDebug ? findings : findings.filter((finding) => finding.severity !== "debug");
}

function withoutDebugCounts(summary: ScanProjectResult["summary"]): ScanProjectResult["summary"] {
  return {
    ...summary,
    findingCount: summary.findingCount - summary.findingsBySeverity.debug,
    findingsBySeverity: {
      ...summary.findingsBySeverity,
      debug: 0,
    },
    diagnosticCount: summary.diagnosticCount - summary.diagnosticsBySeverity.debug,
    diagnosticsBySeverity: {
      ...summary.diagnosticsBySeverity,
      debug: 0,
    },
  };
}

function printTrace(trace: AnalysisTrace, indent: string): void {
  console.log(`${indent}- ${trace.summary}`);
  for (const child of trace.children) {
    printTrace(child, `${indent}  `);
  }
}
