import type { ScannerConfig } from "../config/index.js";
import type { Finding } from "../rules/index.js";
import { severityMeetsThreshold } from "../rules/severity.js";
import { countFindingsByRule, countFindingsBySeverity } from "./summaryCounts.js";
import type { ScanProjectResult } from "./types.js";

type IgnoreMatcher = (value: string) => boolean;

export function applyIgnoreFilter(
  result: ScanProjectResult,
  ignore: ScannerConfig["ignore"],
): ScanProjectResult {
  if (ignore.classNames.length === 0 && ignore.filePaths.length === 0) {
    return result;
  }

  const classMatchers = ignore.classNames.map(buildValueMatcher);
  const pathMatchers = ignore.filePaths.map((filePath) =>
    buildValueMatcher(normalizePath(filePath)),
  );
  const findings = result.findings.filter(
    (finding) => !findingMatchesIgnore(finding, classMatchers, pathMatchers),
  );
  const ignoredFindingCount = result.findings.length - findings.length;
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
      ignoredFindingCount: result.summary.ignoredFindingCount + ignoredFindingCount,
      findingsByRule: countFindingsByRule(findings),
      findingsBySeverity: countFindingsBySeverity(findings),
      failed,
    },
  };
}

export function mergeIgnoreConfig(input: {
  config: ScannerConfig["ignore"];
  overrides?: Partial<ScannerConfig["ignore"]>;
}): ScannerConfig["ignore"] {
  return {
    classNames: [...input.config.classNames, ...(input.overrides?.classNames ?? [])],
    filePaths: [...input.config.filePaths, ...(input.overrides?.filePaths ?? [])],
  };
}

function findingMatchesIgnore(
  finding: Finding,
  classMatchers: IgnoreMatcher[],
  pathMatchers: IgnoreMatcher[],
): boolean {
  if (
    classMatchers.length > 0 &&
    collectFindingClassNames(finding).some((className) =>
      classMatchers.some((matcher) => matcher(className)),
    )
  ) {
    return true;
  }

  if (
    pathMatchers.length > 0 &&
    collectFindingPaths(finding).some((filePath) =>
      pathMatchers.some((matcher) => matcher(normalizePath(filePath))),
    )
  ) {
    return true;
  }

  return false;
}

function collectFindingClassNames(finding: Finding): string[] {
  const data = finding.data ?? {};
  const classNames = new Set<string>();

  for (const key of ["className", "memberName"]) {
    const value = data[key];
    if (typeof value === "string") {
      classNames.add(value);
    }
  }

  for (const key of ["classNames", "requiredClassNames"]) {
    const value = data[key];
    if (!Array.isArray(value)) {
      continue;
    }

    for (const entry of value) {
      if (typeof entry === "string") {
        classNames.add(entry);
      }
    }
  }

  return [...classNames];
}

function collectFindingPaths(finding: Finding): string[] {
  const paths = new Set<string>();
  if (finding.location) {
    paths.add(finding.location.filePath);
  }

  for (const focusFilePath of getFindingFocusFilePaths(finding)) {
    paths.add(focusFilePath);
  }

  for (const entity of [finding.subject, ...finding.evidence]) {
    const entityPath = extractPathFromEntityId(entity.id);
    if (entityPath) {
      paths.add(entityPath);
    }
  }

  for (const key of ["stylesheetFilePath", "componentFilePath"]) {
    const value = finding.data?.[key];
    if (typeof value === "string") {
      paths.add(value);
    }
  }

  const filePathArrays = ["usageLocations", "definitionLocations"];
  for (const key of filePathArrays) {
    const value = finding.data?.[key];
    if (!Array.isArray(value)) {
      continue;
    }

    for (const entry of value) {
      if (entry && typeof entry === "object" && "filePath" in entry) {
        const filePath = entry.filePath;
        if (typeof filePath === "string") {
          paths.add(filePath);
        }
      }
    }
  }

  return [...paths];
}

function getFindingFocusFilePaths(finding: Finding): string[] {
  const focusFilePaths = finding.data?.focusFilePaths;
  if (!Array.isArray(focusFilePaths)) {
    return [];
  }

  return focusFilePaths.filter((filePath): filePath is string => typeof filePath === "string");
}

function extractPathFromEntityId(entityId: string): string | undefined {
  const pathPrefixes = [
    "source:",
    "stylesheet:",
    "class-reference:",
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

function buildValueMatcher(pattern: string): IgnoreMatcher {
  if (hasGlobSyntax(pattern)) {
    const glob = globToRegExp(pattern);
    return (value) => glob.test(value);
  }

  return (value) => value === pattern;
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

  source += "$";
  return new RegExp(source);
}

function normalizePath(filePath: string): string {
  return filePath
    .split("\\")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
