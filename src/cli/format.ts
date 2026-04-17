import type { ResolvedReactCssScannerConfig } from "../config/types.js";
import type { Finding, FindingSeverity, ScanResult } from "../runtime/types.js";

export type ConfigSummaryMode = "off" | "default" | "verbose";
export type HumanOutputMode = "minimal" | "default" | "verbose";

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

export function formatJsonOutput(result: ScanResult, configSummaryMode: ConfigSummaryMode): string {
  const payload: Record<string, unknown> = {
    summary: result.summary,
    findings: result.findings,
  };

  if (configSummaryMode === "default") {
    payload.config = buildDefaultConfigSummary(result.config);
  } else if (configSummaryMode === "verbose") {
    payload.config = result.config;
  }

  return JSON.stringify(payload, null, 2);
}

export function formatHumanReadableOutput(input: {
  result: ScanResult;
  outputMode: HumanOutputMode;
  minSeverity?: FindingSeverity;
  scanTarget: string;
}): string {
  const filteredFindings = input.minSeverity
    ? input.result.findings.filter(
        (finding) => SEVERITY_ORDER[finding.severity] >= SEVERITY_ORDER[input.minSeverity!],
      )
    : input.result.findings;
  const lines: string[] = [];

  lines.push(`Scan target: ${input.scanTarget}`);
  if (input.result.configSource) {
    const sourceLabel = input.result.configSource.filePath
      ? `${input.result.configSource.kind} (${input.result.configSource.filePath})`
      : input.result.configSource.kind;
    lines.push(`Config source: ${sourceLabel}`);
  }
  lines.push(
    `Summary: ${input.result.summary.findingCount} findings (${input.result.summary.errorCount} error, ${input.result.summary.warningCount} warning, ${input.result.summary.infoCount} info) across ${input.result.summary.fileCount} files`,
  );

  if (filteredFindings.length === 0) {
    lines.push("Findings: none");
    return lines.join("\n");
  }

  lines.push("Findings:");
  const groupedFindings = groupFindingsBySubject(filteredFindings);

  for (const group of groupedFindings) {
    if (group.label) {
      lines.push(`- ${group.label}`);
    }

    for (const finding of group.findings) {
      const prefix = group.label ? "  " : "- ";
      const location = finding.primaryLocation?.filePath
        ? ` @ ${finding.primaryLocation.filePath}`
        : "";
      lines.push(
        `${prefix}[${finding.severity}/${finding.confidence}] ${finding.ruleId}${location}: ${finding.message}`,
      );

      if (input.outputMode === "verbose" && finding.relatedLocations.length > 0) {
        for (const relatedLocation of finding.relatedLocations) {
          lines.push(`    related: ${relatedLocation.filePath}`);
        }
      }

      if (input.outputMode !== "minimal" && input.outputMode === "verbose") {
        const metadataEntries = Object.entries(finding.metadata);
        if (metadataEntries.length > 0) {
          lines.push(`    metadata: ${JSON.stringify(finding.metadata)}`);
        }
      }
    }
  }

  return lines.join("\n");
}

function groupFindingsBySubject(
  findings: Finding[],
): Array<{ label?: string; findings: Finding[] }> {
  const groups = new Map<string, Finding[]>();
  const ungrouped: Finding[] = [];

  for (const finding of findings) {
    const label = finding.subject?.className ?? finding.subject?.cssFilePath ?? undefined;

    if (!label) {
      ungrouped.push(finding);
      continue;
    }

    const groupFindings = groups.get(label) ?? [];
    groupFindings.push(finding);
    groups.set(label, groupFindings);
  }

  const grouped: Array<{ label?: string; findings: Finding[] }> = [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, groupFindings]) => ({
      label,
      findings: groupFindings,
    }));

  if (ungrouped.length > 0) {
    grouped.push({
      findings: ungrouped,
    });
  }

  return grouped;
}

function buildDefaultConfigSummary(config: ResolvedReactCssScannerConfig) {
  return {
    rootDir: config.rootDir,
    source: config.source,
    css: {
      global: config.css.global,
      utilities: config.css.utilities,
      modules: config.css.modules,
    },
    externalCss: config.externalCss,
    policy: config.policy,
  };
}
