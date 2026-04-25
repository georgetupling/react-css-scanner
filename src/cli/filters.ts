import type { Finding } from "../rules/index.js";
import type { ScanDiagnostic, ScanProjectResult } from "../project/index.js";

export function includeDebugOutput(result: ScanProjectResult): boolean {
  return result.config.verbosity === "high";
}

export function filterDiagnostics(
  diagnostics: ScanDiagnostic[],
  includeDebug: boolean,
): ScanDiagnostic[] {
  return includeDebug
    ? diagnostics
    : diagnostics.filter((diagnostic) => diagnostic.severity !== "debug");
}

export function filterFindings(findings: Finding[], includeDebug: boolean): Finding[] {
  return includeDebug ? findings : findings.filter((finding) => finding.severity !== "debug");
}

export function withoutDebugCounts(
  summary: ScanProjectResult["summary"],
): ScanProjectResult["summary"] {
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
