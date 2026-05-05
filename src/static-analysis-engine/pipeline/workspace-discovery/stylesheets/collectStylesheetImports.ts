import type { DiscoveryConfig } from "../../../../config/index.js";
import { normalizeProjectPath } from "../../../../project/pathUtils.js";
import type { ProjectStylesheetFile, StylesheetImportFact } from "../types.js";
import { resolveWorkspaceSpecifier } from "../resolution/index.js";

export function collectStylesheetImports(input: {
  stylesheets: ProjectStylesheetFile[];
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
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
        discovery: input.discovery,
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
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
}): string | undefined {
  const resolution = resolveWorkspaceSpecifier({
    importerFilePath: input.fromFilePath,
    specifier: normalizeProjectPath(input.specifier),
    targetKind: "stylesheet",
    knownStylesheetFilePaths: input.knownCssFilePaths,
    discovery: input.discovery,
  });
  return resolution.status === "resolved" && resolution.kind === "project"
    ? resolution.filePath
    : undefined;
}

function compareStylesheetImports(left: StylesheetImportFact, right: StylesheetImportFact): number {
  return `${left.importerFilePath}:${left.specifier}:${left.resolvedFilePath}`.localeCompare(
    `${right.importerFilePath}:${right.specifier}:${right.resolvedFilePath}`,
  );
}
