#!/usr/bin/env node
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { scanProject } from "./project/index.js";
import type { Finding, RuleSeverity } from "./rules/index.js";
import type { ScanDiagnostic, ScanProgressEvent, ScanProjectResult } from "./project/index.js";
import { severityMeetsThreshold } from "./rules/severity.js";

type CliArgs = {
  rootDir?: string;
  configPath?: string;
  focusPaths: string[];
  outputMinSeverity: RuleSeverity;
  outputFile?: string;
  overwriteOutput: boolean;
  json: boolean;
  timings: boolean;
  help: boolean;
};

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const PLANNED_BUT_UNSUPPORTED_FLAGS = new Set(["--print-config", "--verbosity"]);

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

const progressRenderer = createCliProgressRenderer({
  enabled: shouldShowProgress(args),
  stream: process.stderr,
  useColor: shouldUseColor(process.stderr),
});

let result: ScanProjectResult;
try {
  result = await scanProject({
    rootDir: args.rootDir,
    configBaseDir: process.cwd(),
    configPath: args.configPath,
    onProgress: progressRenderer.onProgress,
    collectPerformance: args.timings,
    includeTraces: false,
  });
} finally {
  progressRenderer.stop();
}
const focusedResult = applyFocusFilter(result, args.focusPaths);

if (args.json) {
  try {
    const outputPath = await writeJsonReport({
      result: focusedResult,
      outputFile: args.outputFile,
      overwriteOutput: args.overwriteOutput,
      outputMinSeverity: args.outputMinSeverity,
    });
    console.log(`JSON report written to ${outputPath}`);
    console.log(`Failed: ${focusedResult.failed ? "yes" : "no"}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
} else {
  const visibleDiagnostics = filterDiagnostics(focusedResult.diagnostics, args.outputMinSeverity);
  const visibleFindings = filterFindings(focusedResult.findings, args.outputMinSeverity);

  console.log(
    formatTextReport({
      result: focusedResult,
      diagnostics: visibleDiagnostics,
      findings: visibleFindings,
      focusPaths: args.focusPaths,
      includeTimings: args.timings,
      useColor: shouldUseColor(process.stdout),
    }),
  );
}

process.exit(focusedResult.failed ? 1 : 0);

function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = {
    focusPaths: [],
    outputMinSeverity: "info",
    overwriteOutput: false,
    json: false,
    timings: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--timings") {
      args.timings = true;
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

    if (arg === "--output-file") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--output-file requires a path value.");
      }

      args.outputFile = value;
      index += 1;
      continue;
    }

    if (arg === "--output-min-severity") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CliUsageError("--output-min-severity requires a severity value.");
      }

      if (!isRuleSeverity(value)) {
        throw new CliUsageError(
          '--output-min-severity must be one of "debug", "info", "warn", or "error".',
        );
      }

      args.outputMinSeverity = value;
      index += 1;
      continue;
    }

    if (arg === "--overwrite-output") {
      args.overwriteOutput = true;
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

  if ((args.outputFile || args.overwriteOutput) && !args.json) {
    throw new CliUsageError("--output-file and --overwrite-output require --json.");
  }

  return args;
}

function printHelp(stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(
    `Usage: scan-react-css [rootDir] [--config path] [--focus path-or-glob] [--json] [--output-file path] [--overwrite-output] [--output-min-severity severity] [--timings]\n`,
  );
}

async function writeJsonReport(input: {
  result: ScanProjectResult;
  outputFile?: string;
  overwriteOutput: boolean;
  outputMinSeverity: RuleSeverity;
}): Promise<string> {
  const requestedPath = path.resolve(input.outputFile ?? getDefaultJsonReportPath());
  const outputPath = input.overwriteOutput
    ? requestedPath
    : await findAvailableOutputPath(requestedPath);
  const outputDirectory = path.dirname(outputPath);
  const json = `${JSON.stringify(formatJsonResult(input.result, input.outputMinSeverity), null, 2)}\n`;

  try {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, json, {
      flag: input.overwriteOutput ? "w" : "wx",
    });
  } catch (error) {
    throw new Error(
      `Failed to write JSON report to ${outputPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return outputPath;
}

function getDefaultJsonReportPath(date = new Date()): string {
  return path.join("scan-react-css-reports", `report-${formatReportTimestamp(date)}.json`);
}

function formatReportTimestamp(date: Date): string {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];

  const [year, ...rest] = parts;
  return [String(year), ...rest.map((part) => String(part).padStart(2, "0"))].join("-");
}

async function findAvailableOutputPath(requestedPath: string): Promise<string> {
  if (!(await pathExists(requestedPath))) {
    return requestedPath;
  }

  const parsed = path.parse(requestedPath);
  for (let index = 1; ; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function formatTextReport(input: {
  result: ScanProjectResult;
  diagnostics: ScanDiagnostic[];
  findings: Finding[];
  focusPaths: string[];
  includeTimings: boolean;
  useColor: boolean;
}): string {
  const sections = [
    formatTextHeader(input.result, input.focusPaths),
    ...formatDiagnosticSections(input.diagnostics, input.useColor),
    ...formatFindingSections(input.findings, input.useColor),
    ...(input.includeTimings ? formatTimingSections(input.result) : []),
    formatTextSummary(input.result, input.findings.length),
  ];

  return sections.filter(Boolean).join("\n\n");
}

function formatTextHeader(result: ScanProjectResult, focusPaths: string[]): string {
  const lines = [`scan-react-css reboot scan`, `Root: ${result.rootDir}`];
  if (focusPaths.length > 0) {
    lines.push(`Focus: ${focusPaths.join(", ")}`);
  }

  return lines.join("\n");
}

function formatTimingSections(result: ScanProjectResult): string[] {
  if (!result.performance) {
    return [];
  }

  return [
    [
      "Timings",
      ...result.performance.stages.map(
        (stage) => `  ${stage.stage}: ${formatDuration(stage.durationMs)} (${stage.message})`,
      ),
      `  total: ${formatDuration(result.performance.totalMs)}`,
    ].join("\n"),
  ];
}

function formatDuration(durationMs: number): string {
  return `${durationMs.toFixed(1)}ms`;
}

function formatDiagnosticSections(diagnostics: ScanDiagnostic[], useColor: boolean): string[] {
  if (diagnostics.length === 0) {
    return [];
  }

  const grouped = groupBy(
    diagnostics,
    (diagnostic) => diagnostic.filePath ?? "Diagnostics",
    compareDiagnosticLocations,
  );

  return grouped.map(([heading, group]) => {
    const lines = [heading];
    for (const diagnostic of group.sort(compareDiagnostics)) {
      const severity = colorSeverity(diagnostic.severity, useColor);
      const location = diagnostic.filePath ? ` at ${diagnostic.filePath}` : "";
      lines.push(`  [${severity}] ${diagnostic.code}${location}`);
      lines.push(`          ${diagnostic.message}`);
    }

    return lines.join("\n");
  });
}

function formatFindingSections(findings: Finding[], useColor: boolean): string[] {
  if (findings.length === 0) {
    return ["Findings\n  No findings."];
  }

  const grouped = groupBy(findings, getFindingGroupKey, compareFindingGroupKeys);
  return grouped.map(([heading, group]) => {
    const lines = [heading];
    for (const finding of group.sort(compareFindings)) {
      const severity = colorSeverity(finding.severity, useColor);
      const location = formatFindingLocation(finding);
      const target = location ? ` at ${location}` : "";
      lines.push(`  [${severity}] ${finding.ruleId}${target}`);
      lines.push(`          ${finding.message}`);
    }

    return lines.join("\n");
  });
}

function formatTextSummary(result: ScanProjectResult, visibleFindingCount: number): string {
  return [
    "Summary",
    `  Source files: ${result.summary.sourceFileCount}`,
    `  CSS files: ${result.summary.cssFileCount}`,
    `  Findings: ${visibleFindingCount}`,
    `  Failed: ${result.failed ? "yes" : "no"}`,
    `  Fail on severity: ${result.config.failOnSeverity}`,
    `  Class references: ${result.summary.classReferenceCount}`,
    `  Class definitions: ${result.summary.classDefinitionCount}`,
    `  Selector queries: ${result.summary.selectorQueryCount}`,
  ].join("\n");
}

function formatFindingLocation(finding: Finding): string | undefined {
  return finding.location
    ? `${finding.location.filePath}:${finding.location.startLine}`
    : undefined;
}

function getFindingGroupKey(finding: Finding): string {
  return finding.location?.filePath ?? "Findings";
}

function compareFindingGroupKeys(left: string, right: string): number {
  if (left === "Findings") {
    return 1;
  }

  if (right === "Findings") {
    return -1;
  }

  return left.localeCompare(right);
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    compareRuleSeverities(left.severity, right.severity) ||
    (left.location?.startLine ?? Number.MAX_SAFE_INTEGER) -
      (right.location?.startLine ?? Number.MAX_SAFE_INTEGER) ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.message.localeCompare(right.message)
  );
}

function compareDiagnostics(left: ScanDiagnostic, right: ScanDiagnostic): number {
  return (
    compareDiagnosticSeverities(left.severity, right.severity) ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function compareDiagnosticLocations(left: string, right: string): number {
  if (left === "Diagnostics") {
    return 1;
  }

  if (right === "Diagnostics") {
    return -1;
  }

  return left.localeCompare(right);
}

function compareRuleSeverities(left: RuleSeverity, right: RuleSeverity): number {
  return ruleSeverityRank(left) - ruleSeverityRank(right);
}

function compareDiagnosticSeverities(
  left: ScanDiagnostic["severity"],
  right: ScanDiagnostic["severity"],
): number {
  return diagnosticSeverityRank(left) - diagnosticSeverityRank(right);
}

function ruleSeverityRank(severity: RuleSeverity): number {
  return {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  }[severity];
}

function diagnosticSeverityRank(severity: ScanDiagnostic["severity"]): number {
  return {
    error: 0,
    warning: 1,
    info: 2,
    debug: 3,
  }[severity];
}

function colorSeverity(
  severity: RuleSeverity | ScanDiagnostic["severity"],
  useColor: boolean,
): string {
  if (!useColor) {
    return severity;
  }

  const color = {
    error: "\u001b[31m",
    warn: "\u001b[38;5;208m",
    warning: "\u001b[38;5;208m",
    info: "\u001b[36m",
    debug: "\u001b[90m",
  }[severity];

  return `${color}${severity}\u001b[0m`;
}

function shouldUseColor(stream: NodeJS.WriteStream): boolean {
  return Boolean(stream.isTTY && !process.env.NO_COLOR);
}

type CliProgressRenderer = {
  onProgress?: (event: ScanProgressEvent) => void;
  stop: () => void;
};

function shouldShowProgress(args: CliArgs): boolean {
  return Boolean(!args.json && process.stderr.isTTY);
}

function createCliProgressRenderer(input: {
  enabled: boolean;
  stream: NodeJS.WriteStream;
  useColor: boolean;
}): CliProgressRenderer {
  if (!input.enabled) {
    return {
      stop() {},
    };
  }

  const frames = ["-", "\\", "|", "/"];
  let frameIndex = 0;
  let activeMessage: string | undefined;
  let timer: NodeJS.Timeout | undefined;

  const clearLine = () => {
    input.stream.write("\r\u001b[2K");
  };
  const render = () => {
    if (!activeMessage) {
      return;
    }

    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    const marker = input.useColor ? `\u001b[36m${frame}\u001b[0m` : frame;
    clearLine();
    input.stream.write(`${marker} ${activeMessage}`);
  };
  const startTimer = () => {
    if (timer) {
      return;
    }

    timer = setInterval(render, 120);
    timer.unref();
  };

  return {
    onProgress(event) {
      if (event.status === "completed") {
        if (activeMessage === event.message) {
          activeMessage = undefined;
          clearLine();
        }
        return;
      }

      activeMessage = event.message;
      render();
      startTimer();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      activeMessage = undefined;
      clearLine();
    },
  };
}

function groupBy<T>(
  values: T[],
  getKey: (value: T) => string,
  compareKeys: (left: string, right: string) => number,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = getKey(value);
    const group = groups.get(key);
    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }

  return [...groups.entries()].sort(([left], [right]) => compareKeys(left, right));
}

function formatJsonResult(result: ScanProjectResult, outputMinSeverity: RuleSeverity): object {
  const diagnostics = filterDiagnostics(result.diagnostics, outputMinSeverity);
  const findings = filterFindings(result.findings, outputMinSeverity);

  return {
    rootDir: result.rootDir,
    config: {
      source: result.config.source,
      failOnSeverity: result.config.failOnSeverity,
      rules: result.config.rules,
    },
    diagnostics,
    findings: findings.map(withoutFindingTraces),
    summary: withOutputCounts(result.summary, diagnostics, findings),
    ...(result.performance ? { performance: result.performance } : {}),
    failed: result.failed,
  };
}

function withoutFindingTraces(finding: Finding): Omit<Finding, "traces"> & {
  traces?: Finding["traces"];
} {
  const { traces, ...rest } = finding;
  void traces;
  return rest;
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

  return [...paths];
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

function filterDiagnostics(
  diagnostics: ScanDiagnostic[],
  outputMinSeverity: RuleSeverity,
): ScanDiagnostic[] {
  return diagnostics.filter((diagnostic) =>
    diagnosticSeverityMeetsRuleThreshold(diagnostic.severity, outputMinSeverity),
  );
}

function filterFindings(findings: Finding[], outputMinSeverity: RuleSeverity): Finding[] {
  return findings.filter((finding) => severityMeetsThreshold(finding.severity, outputMinSeverity));
}

function withOutputCounts(
  summary: ScanProjectResult["summary"],
  diagnostics: ScanDiagnostic[],
  findings: Finding[],
): ScanProjectResult["summary"] {
  return {
    ...summary,
    findingCount: findings.length,
    findingsBySeverity: {
      debug: countFindingsBySeverity(findings, "debug"),
      info: countFindingsBySeverity(findings, "info"),
      warn: countFindingsBySeverity(findings, "warn"),
      error: countFindingsBySeverity(findings, "error"),
    },
    diagnosticCount: diagnostics.length,
    diagnosticsBySeverity: {
      debug: countDiagnosticsBySeverity(diagnostics, "debug"),
      info: countDiagnosticsBySeverity(diagnostics, "info"),
      warning: countDiagnosticsBySeverity(diagnostics, "warning"),
      error: countDiagnosticsBySeverity(diagnostics, "error"),
    },
  };
}

function isRuleSeverity(value: string): value is RuleSeverity {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function diagnosticSeverityMeetsRuleThreshold(
  severity: ScanDiagnostic["severity"],
  threshold: RuleSeverity,
): boolean {
  return diagnosticSeverityRankForThreshold(severity) >= ruleSeverityRankForThreshold(threshold);
}

function diagnosticSeverityRankForThreshold(severity: ScanDiagnostic["severity"]): number {
  return {
    error: 3,
    warning: 2,
    info: 1,
    debug: 0,
  }[severity];
}

function ruleSeverityRankForThreshold(severity: RuleSeverity): number {
  return {
    error: 3,
    warn: 2,
    info: 1,
    debug: 0,
  }[severity];
}

function countDiagnosticsBySeverity(
  diagnostics: ScanDiagnostic[],
  severity: ScanDiagnostic["severity"],
): number {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
}
