import type { Finding } from "../rules/index.js";
import type { ScanProjectResult } from "../project/index.js";
import { filterDiagnostics, filterFindings, includeDebugOutput } from "./filters.js";
import { formatTrace } from "./formatTrace.js";

export function formatTextResult(result: ScanProjectResult): string {
  const includeDebug = includeDebugOutput(result);
  const diagnostics = filterDiagnostics(result.diagnostics, includeDebug);
  const findings = filterFindings(result.findings, includeDebug);

  if (result.config.verbosity === "low") {
    return formatLowVerbosityFindings(findings);
  }

  const lines = [
    "scan-react-css scan",
    `Root: ${result.rootDir}`,
    ...(result.focusPath ? [`Focus: ${result.focusPath}`] : []),
    `Source files: ${result.summary.sourceFileCount}`,
    `CSS files: ${result.summary.cssFileCount}`,
    `Findings: ${findings.length}`,
    `Failed: ${result.failed ? "yes" : "no"}`,
    `Fail on severity: ${result.config.failOnSeverity}`,
    `Verbosity: ${result.config.verbosity}`,
    `Class references: ${result.summary.classReferenceCount}`,
    `Class definitions: ${result.summary.classDefinitionCount}`,
    `Selector queries: ${result.summary.selectorQueryCount}`,
  ];

  for (const diagnostic of diagnostics) {
    lines.push(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
  }

  for (const finding of findings) {
    const location = finding.location
      ? ` (${finding.location.filePath}:${finding.location.startLine})`
      : "";
    lines.push(`[${finding.severity}] ${finding.ruleId}: ${finding.message}${location}`);

    if (result.config.verbosity === "high") {
      for (const trace of finding.traces) {
        lines.push(...formatTrace(trace));
      }
    }
  }

  return lines.join("\n");
}

function formatLowVerbosityFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return "No findings";
  }

  const rows = findings.map((finding) => [
    finding.severity,
    finding.ruleId,
    finding.location ? `${finding.location.filePath}:${finding.location.startLine}` : "-",
    finding.message,
  ]);
  const widths = [8, 38, 32, 0];
  const header = formatRow(["Severity", "Rule", "Location", "Message"], widths);
  const divider = formatRow(["--------", "----", "--------", "-------"], widths);

  return [header, divider, ...rows.map((row) => formatRow(row, widths))].join("\n");
}

function formatRow(values: string[], widths: number[]): string {
  return values
    .map((value, index) => (widths[index] > 0 ? value.padEnd(widths[index]) : value))
    .join("  ")
    .trimEnd();
}
