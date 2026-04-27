import type { ScanDiagnostic, ScanProjectResult } from "../project/index.js";
import { countFindingsByRule, countFindingsBySeverity } from "../project/summaryCounts.js";
import type { Finding, RuleSeverity } from "../rules/index.js";
import { severityMeetsThreshold } from "../rules/severity.js";
import type { CliVerbosity } from "./types.js";

export function formatTextReport(input: {
  result: ScanProjectResult;
  diagnostics: ScanDiagnostic[];
  findings: Finding[];
  focusPaths: string[];
  includeTimings: boolean;
  verbosity: CliVerbosity;
  useColor: boolean;
}): string {
  const sections = [
    formatTextHeader(input.result, input.focusPaths),
    ...formatDiagnosticSections(input.diagnostics, input.useColor),
    ...formatFindingSections(input.findings, input.useColor, input.verbosity),
    ...(input.includeTimings ? formatTimingSections(input.result) : []),
    formatTextSummary(input.result, input.findings.length),
  ];

  return sections.filter(Boolean).join("\n\n");
}

export function formatJsonResult(
  result: ScanProjectResult,
  outputMinSeverity: RuleSeverity,
): object {
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

export function filterDiagnostics(
  diagnostics: ScanDiagnostic[],
  outputMinSeverity: RuleSeverity,
): ScanDiagnostic[] {
  return diagnostics.filter((diagnostic) =>
    diagnosticSeverityMeetsRuleThreshold(diagnostic.severity, outputMinSeverity),
  );
}

export function filterFindings(findings: Finding[], outputMinSeverity: RuleSeverity): Finding[] {
  return findings.filter((finding) => severityMeetsThreshold(finding.severity, outputMinSeverity));
}

export function extractPathFromEntityId(entityId: string): string | undefined {
  const pathPrefixes = [
    "source:",
    "stylesheet:",
    "class-reference:",
    "statically-skipped-class-reference:",
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

function formatTextHeader(result: ScanProjectResult, focusPaths: string[]): string {
  const lines = [`scan-react-css scan`, `Root: ${result.rootDir}`];
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

function formatFindingSections(
  findings: Finding[],
  useColor: boolean,
  verbosity: CliVerbosity,
): string[] {
  if (findings.length === 0) {
    return ["Findings\n  No findings."];
  }

  if (verbosity === "low") {
    return [formatLowVerbosityFindings(findings, useColor)];
  }

  if (verbosity === "high") {
    return formatHighVerbosityFindings(findings, useColor);
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
      const hint = getFindingHint(finding);
      if (hint) {
        lines.push(`          hint: ${hint}`);
      }
    }

    return lines.join("\n");
  });
}

function formatLowVerbosityFindings(findings: Finding[], useColor: boolean): string {
  const rows = findings.sort(compareFindings).map((finding) => {
    const severity = colorSeverity(finding.severity, useColor);
    const location = formatFindingLocation(finding) ?? "-";
    return [
      padCell(severity, 8),
      padCell(finding.ruleId, 42),
      padCell(finding.confidence, 10),
      padCell(location, 24),
      finding.message,
    ].join("  ");
  });

  return [
    "Findings",
    [
      padCell("severity", 8),
      padCell("rule", 42),
      padCell("confidence", 10),
      padCell("location", 24),
      "message",
    ].join("  "),
    ...rows,
  ].join("\n");
}

function formatHighVerbosityFindings(findings: Finding[], useColor: boolean): string[] {
  return findings.sort(compareFindings).map((finding, index) => {
    const severity = colorSeverity(finding.severity, useColor);
    const location = formatFindingLocation(finding) ?? "-";
    const lines = [
      `Finding ${index + 1}: ${severity} ${finding.ruleId}`,
      `  Location: ${location}`,
      `  Confidence: ${finding.confidence}`,
      `  Subject: ${finding.subject.kind} ${formatEntityId(finding.subject.id)}`,
      "  Message:",
      `    ${finding.message}`,
    ];

    const detailLines = formatFindingDataLines(finding.data);
    if (detailLines.length > 0) {
      lines.push("  Details:", ...detailLines.map((line) => `    ${line}`));
    }

    if (finding.evidence.length > 0) {
      lines.push(
        "  Evidence:",
        ...finding.evidence.map((entry) => `    - ${entry.kind} ${formatEntityId(entry.id)}`),
      );
    }

    return lines.join("\n");
  });
}

function padCell(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width, " ");
}

function formatFindingDataLines(data: Finding["data"]): string[] {
  if (!data) {
    return [];
  }

  const preferredKeys = [
    "className",
    "selectorText",
    "rawExpressionText",
    "expressionKind",
    "constraint",
    "outcome",
    "status",
    "reasons",
    "stylesheetFilePath",
    "componentName",
    "componentNames",
    "ownerComponentName",
    "consumerComponentName",
    "usageCount",
    "usageReason",
    "usageLocations",
    "staticallySkippedReferenceLocations",
    "definitionCount",
    "definitionLocations",
    "runtimeLibraryHint",
    "selectorTexts",
  ];
  const keys = preferredKeys.filter((key) => Object.hasOwn(data, key));

  return keys.map((key) => `${key}: ${formatDataValue(data[key])}`);
}

function getFindingHint(finding: Finding): string | undefined {
  const runtimeLibraryHint = finding.data?.runtimeLibraryHint;
  if (
    runtimeLibraryHint &&
    typeof runtimeLibraryHint === "object" &&
    "message" in runtimeLibraryHint &&
    typeof runtimeLibraryHint.message === "string"
  ) {
    return runtimeLibraryHint.message;
  }

  return undefined;
}

function formatDataValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => formatDataValue(entry)).join(", ");
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatEntityId(entityId: string): string {
  const path = extractPathFromEntityId(entityId);
  return path ? `${entityId} (${path})` : entityId;
}

function formatTextSummary(result: ScanProjectResult, visibleFindingCount: number): string {
  return [
    "Summary",
    `  Source files: ${result.summary.sourceFileCount}`,
    `  CSS files: ${result.summary.cssFileCount}`,
    `  Findings: ${visibleFindingCount}`,
    `  Ignored findings: ${result.summary.ignoredFindingCount}`,
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

function withoutFindingTraces(finding: Finding): Omit<Finding, "traces"> & {
  traces?: Finding["traces"];
} {
  const { traces, ...rest } = finding;
  void traces;
  return rest;
}

function withOutputCounts(
  summary: ScanProjectResult["summary"],
  diagnostics: ScanDiagnostic[],
  findings: Finding[],
): ScanProjectResult["summary"] {
  return {
    ...summary,
    findingCount: findings.length,
    findingsByRule: countFindingsByRule(findings),
    findingsBySeverity: countFindingsBySeverity(findings),
    diagnosticCount: diagnostics.length,
    diagnosticsBySeverity: {
      debug: countDiagnosticsBySeverity(diagnostics, "debug"),
      info: countDiagnosticsBySeverity(diagnostics, "info"),
      warning: countDiagnosticsBySeverity(diagnostics, "warning"),
      error: countDiagnosticsBySeverity(diagnostics, "error"),
    },
  };
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
