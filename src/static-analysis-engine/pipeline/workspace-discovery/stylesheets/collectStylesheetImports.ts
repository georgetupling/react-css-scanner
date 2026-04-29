import { normalizeProjectPath } from "../../../../project/pathUtils.js";
import type { ProjectStylesheetFile, StylesheetImportFact } from "../types.js";

export function collectStylesheetImports(input: {
  stylesheets: ProjectStylesheetFile[];
}): StylesheetImportFact[] {
  const knownCssFilePaths = new Set(input.stylesheets.map((stylesheet) => stylesheet.filePath));
  const imports: StylesheetImportFact[] = [];

  for (const stylesheet of input.stylesheets) {
    const importerFilePath = normalizeProjectPath(stylesheet.filePath);
    if (!importerFilePath) {
      continue;
    }

    for (const specifier of extractCssImportSpecifiers(stylesheet.cssText)) {
      const resolvedFilePath = resolveCssImportPath({
        fromFilePath: importerFilePath,
        specifier,
        knownCssFilePaths,
      });
      if (!resolvedFilePath) {
        continue;
      }

      imports.push({
        importerFilePath,
        specifier,
        resolvedFilePath,
      });
    }
  }

  return imports.sort(compareStylesheetImports);
}

function extractCssImportSpecifiers(cssText: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^"')\s;]+))(?:\s*\))?[^;]*;/gi;
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(cssText)) !== null) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return [...new Set(specifiers)].sort((left, right) => left.localeCompare(right));
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

function compareStylesheetImports(left: StylesheetImportFact, right: StylesheetImportFact): number {
  return `${left.importerFilePath}:${left.specifier}:${left.resolvedFilePath}`.localeCompare(
    `${right.importerFilePath}:${right.specifier}:${right.resolvedFilePath}`,
  );
}
