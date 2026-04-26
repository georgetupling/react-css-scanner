import type { Finding, RuleSeverity } from "../rules/index.js";
import { severityMeetsThreshold } from "../rules/severity.js";
import type { ScanProjectResult } from "../project/index.js";
import { extractPathFromEntityId } from "./formatter.js";

type FocusMatcher = (filePath: string) => boolean;

export function applyFocusFilter(
  result: ScanProjectResult,
  focusPaths: string[],
): ScanProjectResult {
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
  let normalized = stripLocationSuffix(normalizeProjectPath(focusPath));
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

function stripLocationSuffix(focusPath: string): string {
  return focusPath.replace(/(\.(?:[cm]?[jt]sx?|css)):\d+(?::\d+)?$/i, "$1");
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
