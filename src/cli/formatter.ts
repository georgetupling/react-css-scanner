import path from "node:path";
import type { ScanDiagnostic, ScanProjectResult } from "../project/index.js";
import { countFindingsByRule, countFindingsBySeverity } from "../project/summaryCounts.js";
import type { Finding, RuleSeverity } from "../rules/index.js";
import { severityMeetsThreshold } from "../rules/severity.js";

export function formatTextReport(input: {
  result: ScanProjectResult;
  diagnostics: ScanDiagnostic[];
  findings: Finding[];
  focusPaths: string[];
  includeTimings: boolean;
  verbose: boolean;
  useColor: boolean;
}): string {
  const sections = [
    formatTextHeader(input.result, input.focusPaths),
    ...formatDiagnosticSections(input.diagnostics, input.useColor),
    ...formatFindingSections(input.findings, input.useColor, input.verbose, input.result.rootDir),
    ...(input.includeTimings ? formatTimingSections(input.result) : []),
    formatTextSummary(input.result, input.findings.length),
  ];

  return sections.filter(Boolean).join("\n\n");
}

export function formatJsonResult(
  result: ScanProjectResult,
  outputMinSeverity: RuleSeverity,
  includeTraces: boolean,
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
    findings: includeTraces ? findings : findings.map(withoutFindingTraces),
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
  verbose: boolean,
  rootDir: string,
): string[] {
  if (findings.length === 0) {
    return ["Findings\n  No findings."];
  }

  if (verbose) {
    return formatHighVerbosityFindings(findings, useColor, rootDir);
  }

  const grouped = groupBy(findings, getFindingGroupKey, compareFindingGroupKeys);
  return grouped.map(([heading, group]) => {
    const lines = [formatFindingGroupHeading(heading, rootDir)];
    for (const finding of group.sort(compareFindings)) {
      const severity = colorSeverity(finding.severity, useColor);
      const location = formatFindingLocation(finding, rootDir);
      const target = location && finding.location?.filePath !== heading ? ` at ${location}` : "";
      lines.push(`  [${severity}] ${finding.ruleId}${target} ${finding.message}`);
      const hint = getFindingHint(finding);
      if (hint) {
        lines.push(`          hint: ${hint}`);
      }
    }

    return lines.join("\n");
  });
}

function formatHighVerbosityFindings(
  findings: Finding[],
  useColor: boolean,
  rootDir: string,
): string[] {
  return findings.sort(compareFindings).map((finding, index) => {
    const severity = colorSeverity(finding.severity, useColor);
    const location = formatFindingLocation(finding, rootDir) ?? "-";
    const lines = [
      `Finding ${index + 1}: ${severity} ${finding.ruleId}`,
      `  Location: ${location}`,
      `  Confidence: ${finding.confidence}`,
      `  Subject: ${finding.subject.kind} ${formatEntityId(finding.subject.id)}`,
      "  Message:",
      `    ${finding.message}`,
    ];

    const references = collectInlineReferenceEntries(finding, rootDir);
    if (references.length > 0) {
      lines.push("  Refs:");
      for (const line of formatReferenceEntryLines(references)) {
        lines.push(line);
      }
    }

    const detailLines = formatFindingDataLines(finding.data);
    if (detailLines.length > 0) {
      lines.push("  Details:", ...detailLines.map((line) => `    ${line}`));
    }

    if (finding.evidence.length > 0) {
      lines.push(
        "  Evidence:",
        ...finding.evidence.flatMap((entry) => {
          const detailLines = [`    - ${entry.kind} ${entry.id}`];
          const derivedPath = extractPathFromEntityId(entry.id);
          if (derivedPath) {
            detailLines.push(`      at ${toAbsolutePath(derivedPath, rootDir)}`);
          }
          return detailLines;
        }),
      );
    }

    return lines.join("\n");
  });
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

function collectInlineReferenceEntries(
  finding: Finding,
  rootDir: string,
): Array<{ label: string; anchor: string }> {
  const references: Array<{ label: string; anchor: string }> = [];
  const className = readStringRecordValue(finding.data, "className");
  if (className && finding.location) {
    references.push({
      label: `class "${className}"`,
      anchor: formatAnchor(finding.location, rootDir),
    });
  }

  for (const component of readComponentLocationRecords(finding.data)) {
    references.push({
      label: `component ${component.componentName}`,
      anchor: formatAnchor(component, rootDir),
    });
  }

  return uniqueReferencePairs(references);
}

function readStringRecordValue(value: Finding["data"], key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function readComponentLocationRecords(
  value: Finding["data"],
): Array<{ componentName: string; filePath: string; startLine: number; startColumn: number }> {
  if (!value || typeof value !== "object") {
    return [];
  }

  return [
    ...readComponentLocationsArray(value["componentLocations"]),
    ...readComponentLocationsArray(value["outsideConsumerComponentLocations"]),
    ...readComponentLocationsArray(
      value["ownerComponentLocation"] === undefined ? [] : [value["ownerComponentLocation"]],
    ),
  ];
}

function readComponentLocationsArray(
  value: unknown,
): Array<{ componentName: string; filePath: string; startLine: number; startColumn: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const records: Array<{
    componentName: string;
    filePath: string;
    startLine: number;
    startColumn: number;
  }> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const componentName = readObjectStringField(entry, "componentName");
    const filePath = readObjectStringField(entry, "filePath");
    const startLine = readObjectNumberField(entry, "startLine");
    const startColumn = readObjectNumberField(entry, "startColumn");
    if (!componentName || !filePath || startLine === undefined || startColumn === undefined) {
      continue;
    }

    records.push({
      componentName,
      filePath,
      startLine,
      startColumn,
    });
  }

  return records;
}

function readObjectStringField(value: object, key: string): string | undefined {
  const record = value as Record<string, unknown>;
  const candidate = record[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function readObjectNumberField(value: object, key: string): number | undefined {
  const record = value as Record<string, unknown>;
  const candidate = record[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function uniqueReferencePairs(
  values: Array<{ label: string; anchor: string }>,
): Array<{ label: string; anchor: string }> {
  const seen = new Set<string>();
  const result: Array<{ label: string; anchor: string }> = [];
  for (const value of values) {
    const key = `${value.label}::${value.anchor}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function formatReferenceEntryLines(values: Array<{ label: string; anchor: string }>): string[] {
  if (values.length === 0) {
    return [];
  }

  const labelCounts = new Map<string, number>();
  for (const value of values) {
    labelCounts.set(value.label, (labelCounts.get(value.label) ?? 0) + 1);
  }

  const lines: string[] = [];
  for (const value of values) {
    const isAmbiguous = (labelCounts.get(value.label) ?? 0) > 1;
    if (!isAmbiguous) {
      lines.push(`    - ${value.label}`);
      lines.push(`      at ${value.anchor}`);
      continue;
    }

    lines.push(`    - ${value.label} (${value.anchor})`);
  }

  return lines;
}

function formatAnchor(
  anchor: { filePath: string; startLine: number; startColumn: number },
  rootDir: string,
): string {
  const absolutePath = toAbsolutePath(anchor.filePath, rootDir);
  return `${absolutePath}:${anchor.startLine}:${anchor.startColumn}`;
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

function formatFindingLocation(finding: Finding, rootDir: string): string | undefined {
  if (!finding.location) {
    return undefined;
  }

  const absolutePath = toAbsolutePath(finding.location.filePath, rootDir);
  const shortLabel = `${path.basename(finding.location.filePath)}:${finding.location.startLine}`;
  return `${shortLabel} (${absolutePath}:${finding.location.startLine})`;
}

function toAbsolutePath(filePath: string, rootDir: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
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

function formatFindingGroupHeading(groupKey: string, rootDir: string): string {
  if (groupKey === "Findings") {
    return groupKey;
  }

  const absolutePath = toAbsolutePath(groupKey, rootDir);
  return `${path.basename(groupKey)} (${absolutePath})`;
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
