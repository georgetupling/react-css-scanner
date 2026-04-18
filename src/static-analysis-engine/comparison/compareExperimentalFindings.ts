import type { Finding } from "../../runtime/types.js";
import type { ExperimentalFindingComparison, ExperimentalFindingLike } from "./types.js";

export function compareExperimentalFindings(input: {
  experimentalFindings: ExperimentalFindingLike[];
  baselineFindings: Finding[];
}): ExperimentalFindingComparison {
  const unmatchedBaseline = new Map<string, Finding[]>();
  for (const finding of input.baselineFindings) {
    const key = createBaselineFindingKey(finding);
    const existing = unmatchedBaseline.get(key) ?? [];
    existing.push(finding);
    unmatchedBaseline.set(key, existing);
  }

  const matched: ExperimentalFindingComparison["matched"] = [];
  const experimentalOnly: ExperimentalFindingLike[] = [];

  for (const experimentalFinding of input.experimentalFindings) {
    const key = createExperimentalFindingKey(experimentalFinding);
    const baselineGroup = unmatchedBaseline.get(key);
    const baselineFinding = baselineGroup?.shift();
    if (baselineFinding) {
      matched.push({
        experimental: experimentalFinding,
        baseline: baselineFinding,
      });

      if (baselineGroup && baselineGroup.length === 0) {
        unmatchedBaseline.delete(key);
      }

      continue;
    }

    experimentalOnly.push(experimentalFinding);
  }

  return {
    matched,
    experimentalOnly,
    baselineOnly: [...unmatchedBaseline.values()].flat(),
  };
}

function createExperimentalFindingKey(finding: ExperimentalFindingLike): string {
  return JSON.stringify({
    ruleId: finding.ruleId,
    message: finding.message,
    filePath: finding.filePath ?? null,
    line: finding.line ?? null,
  });
}

function createBaselineFindingKey(finding: Finding): string {
  return JSON.stringify({
    ruleId: finding.ruleId,
    message: finding.message,
    filePath: finding.primaryLocation?.filePath ?? null,
    line: finding.primaryLocation?.line ?? null,
  });
}
