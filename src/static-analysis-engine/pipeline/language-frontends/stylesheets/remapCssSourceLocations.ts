import path from "node:path";
import { TraceMap, originalPositionFor, type SourceMapInput } from "@jridgewell/trace-mapping";

import type { CssStyleRuleFact } from "../../../types/css.js";
import type { SourceAnchor } from "../../../types/core.js";
import type { ProjectStylesheetFile } from "../../workspace-discovery/index.js";

export function remapCssStyleRuleLocations(input: {
  rules: CssStyleRuleFact[];
  stylesheet: ProjectStylesheetFile;
  rootDir: string;
}): CssStyleRuleFact[] {
  const sourceMap = input.stylesheet.compiledFrom?.sourceMap;
  if (!sourceMap) {
    return input.rules;
  }

  const traceMap = new TraceMap(sourceMap as SourceMapInput);
  return input.rules.map((rule) => {
    const selectorEntries = rule.selectorEntries.map((entry) => {
      if (!entry.selectorAnchor) {
        return entry;
      }

      const selectorAnchor = remapAnchor({
        anchor: entry.selectorAnchor,
        traceMap,
        stylesheet: input.stylesheet,
        rootDir: input.rootDir,
      });

      return {
        ...entry,
        selectorAnchor,
      };
    });
    const firstAnchor = selectorEntries[0]?.selectorAnchor;

    return {
      ...rule,
      selectorEntries,
      line: firstAnchor?.startLine ?? rule.line,
    };
  });
}

function remapAnchor(input: {
  anchor: SourceAnchor;
  traceMap: TraceMap;
  stylesheet: ProjectStylesheetFile;
  rootDir: string;
}): SourceAnchor {
  const mappedStart = originalPositionFor(input.traceMap, {
    line: input.anchor.startLine,
    column: Math.max(0, input.anchor.startColumn - 1),
  });
  if (!mappedStart.source || mappedStart.line === null || mappedStart.column === null) {
    return input.anchor;
  }

  const mappedFilePath = resolveMappedSourcePath({
    source: mappedStart.source,
    stylesheet: input.stylesheet,
    rootDir: input.rootDir,
  });
  if (!mappedFilePath) {
    return input.anchor;
  }

  const mappedEnd =
    input.anchor.endLine !== undefined && input.anchor.endColumn !== undefined
      ? originalPositionFor(input.traceMap, {
          line: input.anchor.endLine,
          column: Math.max(0, input.anchor.endColumn - 1),
        })
      : undefined;
  const endMatchesStartSource =
    mappedEnd?.source &&
    mappedEnd.line !== null &&
    mappedEnd.column !== null &&
    resolveMappedSourcePath({
      source: mappedEnd.source,
      stylesheet: input.stylesheet,
      rootDir: input.rootDir,
    }) === mappedFilePath;

  return {
    filePath: mappedFilePath,
    startLine: mappedStart.line,
    startColumn: mappedStart.column + 1,
    ...(endMatchesStartSource
      ? {
          endLine: mappedEnd.line,
          endColumn: (mappedEnd.column ?? 0) + 1,
        }
      : {
          endLine: mappedStart.line,
          endColumn: mappedStart.column + 1,
        }),
  };
}

function resolveMappedSourcePath(input: {
  source: string;
  stylesheet: ProjectStylesheetFile;
  rootDir: string;
}): string | undefined {
  const source = input.source.replace(/\\/g, "/");
  if (
    source === input.stylesheet.filePath ||
    source === path.posix.basename(input.stylesheet.filePath)
  ) {
    return input.stylesheet.filePath;
  }

  if (
    /^[a-z][a-z0-9+.-]*:/i.test(source) &&
    !source.startsWith("file://") &&
    !isWindowsAbsolutePath(source)
  ) {
    return undefined;
  }

  const sourcePath = source.startsWith("file://")
    ? normalizeFileUrlPath(new URL(source).pathname)
    : source;
  const candidateAbsolutePath = isWindowsAbsolutePath(sourcePath)
    ? path.win32.normalize(sourcePath)
    : path.isAbsolute(sourcePath)
      ? sourcePath
      : path.resolve(
          path.dirname(
            input.stylesheet.absolutePath ?? path.resolve(input.rootDir, input.stylesheet.filePath),
          ),
          sourcePath,
        );
  if (!isPathInsideRoot(input.rootDir, candidateAbsolutePath)) {
    return input.stylesheet.filePath;
  }

  return normalizeProjectPath(path.relative(input.rootDir, candidateAbsolutePath));
}

function isPathInsideRoot(rootDir: string, absolutePath: string): boolean {
  const relativePath = path.relative(rootDir, absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isWindowsAbsolutePath(filePath: string): boolean {
  return /^[a-z]:\//i.test(filePath);
}

function normalizeFileUrlPath(filePath: string): string {
  return /^\/[a-z]:\//i.test(filePath) ? filePath.slice(1) : filePath;
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
