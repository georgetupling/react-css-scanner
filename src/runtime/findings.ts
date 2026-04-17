import type { Finding, FindingSeverity, ScanSummary } from "./types.js";
import type { CreateFindingInput } from "../rules/types.js";

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const CONFIDENCE_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
} as const;

export function createFinding(input: CreateFindingInput): Finding {
  return {
    ruleId: input.ruleId,
    family: input.family,
    severity: input.severity,
    confidence: input.confidence,
    message: input.message,
    primaryLocation: input.primaryLocation,
    relatedLocations: input.relatedLocations ?? [],
    subject: input.subject,
    metadata: input.metadata ?? {},
  };
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const severityDifference = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severityDifference !== 0) {
      return severityDifference;
    }

    const confidenceDifference =
      CONFIDENCE_ORDER[left.confidence] - CONFIDENCE_ORDER[right.confidence];
    if (confidenceDifference !== 0) {
      return confidenceDifference;
    }

    const leftSubjectKey = getSubjectSortKey(left);
    const rightSubjectKey = getSubjectSortKey(right);
    if (leftSubjectKey !== rightSubjectKey) {
      return leftSubjectKey.localeCompare(rightSubjectKey);
    }

    const leftLocationKey = left.primaryLocation?.filePath ?? "";
    const rightLocationKey = right.primaryLocation?.filePath ?? "";
    if (leftLocationKey !== rightLocationKey) {
      return leftLocationKey.localeCompare(rightLocationKey);
    }

    if (left.ruleId !== right.ruleId) {
      return left.ruleId.localeCompare(right.ruleId);
    }

    return left.message.localeCompare(right.message);
  });
}

export function buildScanSummary(input: {
  sourceFileCount: number;
  cssFileCount: number;
  findings: Finding[];
}): ScanSummary {
  const summary: ScanSummary = {
    fileCount: input.sourceFileCount + input.cssFileCount,
    sourceFileCount: input.sourceFileCount,
    cssFileCount: input.cssFileCount,
    findingCount: input.findings.length,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
  };

  for (const finding of input.findings) {
    if (finding.severity === "error") {
      summary.errorCount += 1;
      continue;
    }

    if (finding.severity === "warning") {
      summary.warningCount += 1;
      continue;
    }

    summary.infoCount += 1;
  }

  return summary;
}

function getSubjectSortKey(finding: Finding): string {
  return (
    finding.subject?.className ??
    finding.subject?.cssFilePath ??
    finding.subject?.sourceFilePath ??
    ""
  );
}
