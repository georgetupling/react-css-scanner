import type { ResolvedScanReactCssConfig } from "../config/types.js";
import type { Finding, FindingLocation, FindingSeverity, ScanResult } from "../runtime/types.js";

export type OutputVerbosity = "low" | "medium" | "high";

const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  error: "ERROR",
  warning: "WARNING",
  info: "INFO",
  debug: "DEBUG",
};

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

export function formatJsonOutput(result: ScanResult, printConfig: boolean): string {
  const payload: Record<string, unknown> = {
    summary: result.summary,
    findings: result.findings,
  };

  if ((result.operationalWarnings?.length ?? 0) > 0) {
    payload.operationalWarnings = result.operationalWarnings;
  }

  if (printConfig) {
    payload.config = result.config;
  }

  return JSON.stringify(payload, null, 2);
}

export function formatHumanReadableOutput(input: {
  result: ScanResult;
  verbosity: OutputVerbosity;
  scanTarget: string;
  focusPath?: string;
  printConfig: boolean;
}): string {
  const filteredFindings = input.result.findings;
  const lines: string[] = [];
  const displayPaths = buildDisplayPathMap(collectFindingPaths(filteredFindings));

  lines.push(`Scan target: ${input.scanTarget}`);
  if (input.focusPath) {
    lines.push(`Focus path: ${input.focusPath}`);
  }
  if (input.result.configSource) {
    const sourceLabel = input.result.configSource.filePath
      ? `${input.result.configSource.kind} (${input.result.configSource.filePath})`
      : input.result.configSource.kind;
    lines.push(`Config source: ${sourceLabel}`);
  }

  if (filteredFindings.length === 0) {
    lines.push("");
    lines.push("Findings: none");
  } else {
    lines.push("");
    if (input.verbosity === "low") {
      lines.push(...renderLowVerbosityFindings(filteredFindings, displayPaths));
    } else {
      lines.push(...renderGroupedFindings(filteredFindings, displayPaths, input.verbosity));
    }
  }

  if (input.printConfig) {
    lines.push("");
    lines.push("Config:");
    lines.push(JSON.stringify(resultConfigForPrint(input.result.config), null, 2));
  }

  lines.push("");
  lines.push("Summary");
  lines.push(
    `${input.result.summary.findingCount} findings across ${input.result.summary.fileCount} files`,
  );
  lines.push(
    `${input.result.summary.errorCount} error, ${input.result.summary.warningCount} warning, ${input.result.summary.infoCount} info${
      input.result.summary.debugCount > 0 ? `, ${input.result.summary.debugCount} debug` : ""
    }`,
  );

  return lines.join("\n");
}

function renderLowVerbosityFindings(
  findings: Finding[],
  displayPaths: Map<string, string>,
): string[] {
  const rows = [...findings].sort(compareFindings(displayPaths)).map((finding) => ({
    severity: SEVERITY_LABELS[finding.severity],
    ruleId: finding.ruleId,
    location: formatLocationCompact(finding.primaryLocation, displayPaths),
    subject: formatSubject(finding),
  }));

  const severityWidth = Math.max("Severity".length, ...rows.map((row) => row.severity.length));
  const ruleWidth = Math.max("Rule".length, ...rows.map((row) => row.ruleId.length));
  const locationWidth = Math.max("Location".length, ...rows.map((row) => row.location.length));

  const lines = [
    `${"Severity".padEnd(severityWidth)}  ${"Rule".padEnd(ruleWidth)}  ${"Location".padEnd(locationWidth)}  Subject`,
  ];

  for (const row of rows) {
    lines.push(
      `${colorizeSeverity(row.severity.padEnd(severityWidth), row.severity)}  ${row.ruleId.padEnd(ruleWidth)}  ${row.location.padEnd(locationWidth)}  ${row.subject}`,
    );
  }

  return lines;
}

function renderGroupedFindings(
  findings: Finding[],
  displayPaths: Map<string, string>,
  verbosity: Exclude<OutputVerbosity, "low">,
): string[] {
  const lines: string[] = [];
  const groups = groupFindingsByDirectory(findings, displayPaths);

  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex > 0) {
      lines.push("");
      lines.push("");
    }

    lines.push(group.label);
    lines.push("");

    for (const [findingIndex, finding] of group.findings.entries()) {
      if (findingIndex > 0) {
        lines.push("");
      }

      if (verbosity === "medium") {
        lines.push(...renderMediumFinding(finding, displayPaths));
      } else {
        lines.push(...renderHighFinding(finding, displayPaths));
      }
    }
  }

  return lines;
}

function renderMediumFinding(finding: Finding, displayPaths: Map<string, string>): string[] {
  return [
    `${colorizeSeverity(SEVERITY_LABELS[finding.severity], SEVERITY_LABELS[finding.severity])}  ${finding.ruleId}  ${formatLocationCompact(finding.primaryLocation, displayPaths)}`,
    finding.message,
  ];
}

function renderHighFinding(finding: Finding, displayPaths: Map<string, string>): string[] {
  const lines = [
    `${colorizeSeverity(SEVERITY_LABELS[finding.severity], SEVERITY_LABELS[finding.severity])}  ${finding.ruleId}`,
    formatLocationCompact(finding.primaryLocation, displayPaths),
    finding.message,
  ];

  const subject = formatSubject(finding);
  if (subject !== "-") {
    lines.push(`Subject: ${subject}`);
  }

  lines.push(`Confidence: ${finding.confidence}`);

  if (finding.relatedLocations.length > 0) {
    lines.push("Related:");
    for (const relatedLocation of finding.relatedLocations) {
      lines.push(`  ${formatLocationCompact(relatedLocation, displayPaths)}`);
    }
  }

  const metadataEntries = Object.entries(finding.metadata);
  if (metadataEntries.length > 0) {
    lines.push("Metadata:");
    for (const [key, value] of metadataEntries.sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      lines.push(`  ${key}: ${formatMetadataValue(value)}`);
    }
  }

  return lines;
}

function groupFindingsByDirectory(
  findings: Finding[],
  displayPaths: Map<string, string>,
): Array<{ label: string; findings: Finding[] }> {
  const groups = new Map<string, Finding[]>();

  for (const finding of findings) {
    const label = getDirectoryGroupLabel(finding.primaryLocation);
    const groupFindings = groups.get(label) ?? [];
    groupFindings.push(finding);
    groups.set(label, groupFindings);
  }

  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, groupFindings]) => ({
      label,
      findings: [...groupFindings].sort(compareFindings(displayPaths)),
    }));
}

function compareFindings(displayPaths: Map<string, string>) {
  return (left: Finding, right: Finding): number => {
    const severityDifference = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severityDifference !== 0) {
      return severityDifference;
    }

    const leftLocation = formatLocationCompact(left.primaryLocation, displayPaths);
    const rightLocation = formatLocationCompact(right.primaryLocation, displayPaths);
    if (leftLocation !== rightLocation) {
      return leftLocation.localeCompare(rightLocation);
    }

    const leftLine = left.primaryLocation?.line ?? 0;
    const rightLine = right.primaryLocation?.line ?? 0;
    if (leftLine !== rightLine) {
      return leftLine - rightLine;
    }

    return left.ruleId.localeCompare(right.ruleId);
  };
}

function collectFindingPaths(findings: Finding[]): string[] {
  const paths = new Set<string>();

  for (const finding of findings) {
    if (finding.primaryLocation?.filePath) {
      paths.add(finding.primaryLocation.filePath);
    }

    for (const relatedLocation of finding.relatedLocations) {
      if (relatedLocation.filePath) {
        paths.add(relatedLocation.filePath);
      }
    }
  }

  return [...paths];
}

function buildDisplayPathMap(filePaths: string[]): Map<string, string> {
  const segmentsByPath = new Map(filePaths.map((filePath) => [filePath, filePath.split("/")]));
  const pathMap = new Map<string, string>();

  for (const filePath of filePaths) {
    const pathSegments = segmentsByPath.get(filePath) ?? [filePath];
    let displayPath = pathSegments.at(-1) ?? filePath;

    if (isUniqueDisplayPath(filePath, displayPath, segmentsByPath)) {
      pathMap.set(filePath, displayPath);
      continue;
    }

    for (let segmentCount = 2; segmentCount <= pathSegments.length; segmentCount += 1) {
      displayPath = pathSegments.slice(-segmentCount).join("/");
      if (isUniqueDisplayPath(filePath, displayPath, segmentsByPath)) {
        break;
      }
    }

    pathMap.set(filePath, displayPath);
  }

  return pathMap;
}

function isUniqueDisplayPath(
  targetPath: string,
  candidateDisplayPath: string,
  segmentsByPath: Map<string, string[]>,
): boolean {
  for (const [otherPath, otherSegments] of segmentsByPath.entries()) {
    if (otherPath === targetPath) {
      continue;
    }

    if (otherSegments.join("/").endsWith(candidateDisplayPath)) {
      return false;
    }
  }

  return true;
}

function formatLocationCompact(
  location: FindingLocation | undefined,
  displayPaths: Map<string, string>,
): string {
  if (!location?.filePath) {
    return "-";
  }

  const displayPath = displayPaths.get(location.filePath) ?? location.filePath;
  const lineSuffix =
    typeof location.line === "number"
      ? `:${location.line}${typeof location.column === "number" ? `:${location.column}` : ""}`
      : "";

  return `${displayPath}${lineSuffix}`;
}

function getDirectoryGroupLabel(location: FindingLocation | undefined): string {
  if (!location?.filePath) {
    return "Other Findings";
  }

  const segments = location.filePath.split("/");
  segments.pop();
  const directory = segments.join("/");
  return directory || "(project root)";
}

function formatSubject(finding: Finding): string {
  return (
    finding.subject?.className ??
    finding.subject?.cssFilePath ??
    finding.subject?.sourceFilePath ??
    "-"
  );
}

function colorizeSeverity(formattedLabel: string, rawLabel: string): string {
  if (!shouldUseColor()) {
    return formattedLabel;
  }

  switch (rawLabel) {
    case "ERROR":
      return `\u001B[31m${formattedLabel}\u001B[0m`;
    case "WARNING":
      return `\u001B[33m${formattedLabel}\u001B[0m`;
    case "INFO":
      return `\u001B[36m${formattedLabel}\u001B[0m`;
    case "DEBUG":
      return `\u001B[2m${formattedLabel}\u001B[0m`;
    default:
      return formattedLabel;
  }
}

function formatMetadataValue(value: unknown): string {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function shouldUseColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function resultConfigForPrint(config: ResolvedScanReactCssConfig) {
  return config;
}
