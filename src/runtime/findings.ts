import type { Finding, FindingLocation, FindingSeverity, ScanSummary } from "./types.js";
import type { CreateFindingInput } from "../rules/types.js";

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

const CONFIDENCE_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
} as const;

const AGGREGATE_OCCURRENCE_COUNT_KEY = "aggregateOccurrenceCount";

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

export function collateFindings(findings: Finding[]): Finding[] {
  const findingsByKey = new Map<string, Finding[]>();

  for (const finding of findings) {
    const key = createFindingAggregationKey(finding);
    const grouped = findingsByKey.get(key) ?? [];
    grouped.push(finding);
    findingsByKey.set(key, grouped);
  }

  return sortFindings(
    [...findingsByKey.values()].map((groupedFindings) => collateFindingGroup(groupedFindings)),
  );
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
    debugCount: 0,
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

    if (finding.severity === "info") {
      summary.infoCount += 1;
      continue;
    }

    summary.debugCount += 1;
  }

  return summary;
}

export function filterFindingsByMinSeverity(
  findings: Finding[],
  minSeverity: FindingSeverity,
): Finding[] {
  return findings.filter(
    (finding) => SEVERITY_ORDER[finding.severity] <= SEVERITY_ORDER[minSeverity],
  );
}

function getSubjectSortKey(finding: Finding): string {
  return (
    finding.subject?.className ??
    finding.subject?.cssFilePath ??
    finding.subject?.sourceFilePath ??
    ""
  );
}

function collateFindingGroup(findings: Finding[]): Finding {
  const [firstFinding] = findings;
  if (!firstFinding) {
    throw new Error("Cannot collate an empty finding group.");
  }

  const allPrimaryLocations: FindingLocation[] = [];
  const allRelatedLocations: FindingLocation[] = [];
  let aggregateOccurrenceCount = 0;

  for (const finding of findings) {
    aggregateOccurrenceCount += getAggregateOccurrenceCount(finding);

    if (finding.primaryLocation) {
      allPrimaryLocations.push(finding.primaryLocation);
    }

    allRelatedLocations.push(...finding.relatedLocations);
  }

  const uniquePrimaryLocations = dedupeLocations(allPrimaryLocations);
  const sortedPrimaryLocations = [...uniquePrimaryLocations].sort(compareLocations);
  const primaryLocation = sortedPrimaryLocations[0] ?? firstFinding.primaryLocation;

  const relatedLocations = dedupeLocations([
    ...allRelatedLocations,
    ...sortedPrimaryLocations.slice(primaryLocation ? 1 : 0),
  ]).filter((location) => !locationsEqual(location, primaryLocation));

  const metadata =
    aggregateOccurrenceCount > 1
      ? {
          ...firstFinding.metadata,
          [AGGREGATE_OCCURRENCE_COUNT_KEY]: aggregateOccurrenceCount,
        }
      : firstFinding.metadata;

  return {
    ...firstFinding,
    primaryLocation,
    relatedLocations: relatedLocations.sort(compareLocations),
    metadata,
  };
}

function createFindingAggregationKey(finding: Finding): string {
  return stableSerialize({
    ruleId: finding.ruleId,
    family: finding.family,
    severity: finding.severity,
    confidence: finding.confidence,
    message: finding.message,
    subject: finding.subject ?? null,
    metadata: omitAggregateOccurrenceCount(finding.metadata),
  });
}

function omitAggregateOccurrenceCount(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key !== AGGREGATE_OCCURRENCE_COUNT_KEY),
  );
}

function dedupeLocations(locations: FindingLocation[]): FindingLocation[] {
  const uniqueLocations = new Map<string, FindingLocation>();

  for (const location of locations) {
    const key = stableSerialize(location);
    if (!uniqueLocations.has(key)) {
      uniqueLocations.set(key, location);
    }
  }

  return [...uniqueLocations.values()];
}

function getAggregateOccurrenceCount(finding: Finding): number {
  const count = finding.metadata[AGGREGATE_OCCURRENCE_COUNT_KEY];
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : 1;
}

function compareLocations(left: FindingLocation, right: FindingLocation): number {
  const filePathComparison = left.filePath.localeCompare(right.filePath);
  if (filePathComparison !== 0) {
    return filePathComparison;
  }

  const lineComparison = (left.line ?? 0) - (right.line ?? 0);
  if (lineComparison !== 0) {
    return lineComparison;
  }

  const columnComparison = (left.column ?? 0) - (right.column ?? 0);
  if (columnComparison !== 0) {
    return columnComparison;
  }

  return (left.context ?? "").localeCompare(right.context ?? "");
}

function locationsEqual(
  left: FindingLocation | undefined,
  right: FindingLocation | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.filePath === right.filePath &&
    left.line === right.line &&
    left.column === right.column &&
    left.context === right.context
  );
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([key, entryValue]) => [key, normalizeValue(entryValue)]),
    );
  }

  return value;
}
