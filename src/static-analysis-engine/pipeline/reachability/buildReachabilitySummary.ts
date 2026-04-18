import type { ModuleGraph } from "../module-graph/types.js";
import type { SelectorSourceInput } from "../selector-analysis/types.js";
import type { ReachabilitySummary, StylesheetReachabilityRecord } from "./types.js";

export function buildReachabilitySummary(input: {
  moduleGraph: ModuleGraph;
  cssSources: SelectorSourceInput[];
}): ReachabilitySummary {
  const knownCssFilePaths = new Set(
    input.cssSources
      .map((cssSource) => normalizeProjectPath(cssSource.filePath))
      .filter(Boolean) as string[],
  );

  return {
    stylesheets: input.cssSources.map((cssSource) =>
      buildStylesheetReachabilityRecord({
        cssSource,
        moduleGraph: input.moduleGraph,
        knownCssFilePaths,
      }),
    ),
  };
}

function buildStylesheetReachabilityRecord(input: {
  cssSource: SelectorSourceInput;
  moduleGraph: ModuleGraph;
  knownCssFilePaths: Set<string>;
}): StylesheetReachabilityRecord {
  const cssFilePath = normalizeProjectPath(input.cssSource.filePath);
  if (!cssFilePath) {
    return {
      cssFilePath: input.cssSource.filePath,
      availability: "unknown",
      directlyImportingSourceFilePaths: [],
      reasons: [
        "stylesheet source does not have a file path, so reachability cannot be determined",
      ],
    };
  }

  const directlyImportingSourceFilePaths: string[] = [];
  for (const moduleNode of input.moduleGraph.modulesById.values()) {
    if (moduleNode.kind !== "source") {
      continue;
    }

    const importsCssSource = moduleNode.imports.some((importRecord) => {
      if (importRecord.importKind !== "css") {
        return false;
      }

      return (
        resolveCssImportPath({
          fromFilePath: moduleNode.filePath,
          specifier: importRecord.specifier,
          knownCssFilePaths: input.knownCssFilePaths,
        }) === cssFilePath
      );
    });

    if (importsCssSource) {
      directlyImportingSourceFilePaths.push(moduleNode.filePath.replace(/\\/g, "/"));
    }
  }

  if (directlyImportingSourceFilePaths.length > 0) {
    return {
      cssFilePath: input.cssSource.filePath,
      availability: "definite",
      directlyImportingSourceFilePaths: directlyImportingSourceFilePaths.sort((left, right) =>
        left.localeCompare(right),
      ),
      reasons: [
        `stylesheet is directly imported by ${directlyImportingSourceFilePaths.length} analyzed source file${directlyImportingSourceFilePaths.length === 1 ? "" : "s"}`,
      ],
    };
  }

  return {
    cssFilePath: input.cssSource.filePath,
    availability: "unavailable",
    directlyImportingSourceFilePaths: [],
    reasons: ["no analyzed source file directly imports this stylesheet"],
  };
}

function resolveCssImportPath(input: {
  fromFilePath: string;
  specifier: string;
  knownCssFilePaths: Set<string>;
}): string | undefined {
  const normalizedSpecifier = normalizeProjectPath(input.specifier);
  const normalizedFromFilePath = normalizeProjectPath(input.fromFilePath);
  if (!normalizedSpecifier || !normalizedFromFilePath) {
    return undefined;
  }

  if (!normalizedSpecifier.endsWith(".css")) {
    return undefined;
  }

  if (!normalizedSpecifier.startsWith(".")) {
    return undefined;
  }

  const fromSegments = normalizedFromFilePath.split("/");
  fromSegments.pop();
  const specifierSegments = normalizedSpecifier.split("/").filter((segment) => segment.length > 0);
  const candidatePath = normalizeSegments([...fromSegments, ...specifierSegments]);
  return input.knownCssFilePaths.has(candidatePath) ? candidatePath : undefined;
}

function normalizeSegments(segments: string[]): string {
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalized.pop();
      continue;
    }

    normalized.push(segment);
  }

  return normalized.join("/");
}

function normalizeProjectPath(filePath: string | undefined): string | undefined {
  return filePath?.replace(/\\/g, "/");
}
