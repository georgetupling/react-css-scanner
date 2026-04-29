import {
  getDirectStylesheetImportFacts,
  getAllResolvedModuleFacts,
  type ModuleFacts,
} from "../module-facts/index.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type {
  ReachabilityStylesheetInput,
  StylesheetReachabilityContextRecord,
  StylesheetReachabilityRecord,
} from "./types.js";
import type { StylesheetImportRecord } from "./internalTypes.js";
import { normalizeProjectPath, resolveCssImportPath } from "./pathUtils.js";
import {
  addContextRecord,
  getAvailabilityFromContexts,
  withStylesheetRecordTraces,
} from "./recordUtils.js";
import {
  compareContextRecords,
  compareStylesheetImportRecords,
  createPackageCssImportKey,
} from "./sortAndKeys.js";

export function collectDirectCssImportersByStylesheetPath(input: {
  moduleFacts: ModuleFacts;
  knownCssFilePaths: Set<string>;
  packageCssImportBySpecifier: Map<string, string>;
  sourcePackageCssImports: ExternalCssSummary["packageCssImports"];
}): Map<string, string[]> {
  const importersByStylesheetPath = new Map<string, Set<string>>();

  for (const moduleFacts of getAllResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
  })) {
    const sourceFilePath = normalizeProjectPath(moduleFacts.filePath) ?? moduleFacts.filePath;
    for (const importFact of getDirectStylesheetImportFacts({
      moduleFacts: input.moduleFacts,
      filePath: moduleFacts.filePath,
    })) {
      const stylesheetPath =
        importFact.importKind === "css" && importFact.resolution.status === "resolved"
          ? (normalizeProjectPath(importFact.resolution.resolvedFilePath) ??
            resolveCssImportPath({
              fromFilePath: moduleFacts.filePath,
              specifier: importFact.specifier,
              knownCssFilePaths: input.knownCssFilePaths,
            }))
          : importFact.importKind === "css" && importFact.resolution.status === "external"
            ? (input.packageCssImportBySpecifier.get(
                createPackageCssImportKey(moduleFacts.filePath, importFact.specifier),
              ) ??
              normalizeProjectPath(importFact.specifier) ??
              importFact.specifier)
            : importFact.importKind === "external-css"
              ? (input.packageCssImportBySpecifier.get(
                  createPackageCssImportKey(moduleFacts.filePath, importFact.specifier),
                ) ??
                normalizeProjectPath(importFact.specifier) ??
                importFact.specifier)
              : undefined;

      if (!stylesheetPath) {
        continue;
      }

      const importers = importersByStylesheetPath.get(stylesheetPath) ?? new Set<string>();
      importers.add(sourceFilePath);
      importersByStylesheetPath.set(stylesheetPath, importers);
    }
  }

  for (const importRecord of input.sourcePackageCssImports) {
    if (importRecord.importerKind !== "source") {
      continue;
    }

    const stylesheetPath =
      normalizeProjectPath(importRecord.resolvedFilePath) ?? importRecord.resolvedFilePath;
    const sourceFilePath =
      normalizeProjectPath(importRecord.importerFilePath) ?? importRecord.importerFilePath;
    const importers = importersByStylesheetPath.get(stylesheetPath) ?? new Set<string>();
    importers.add(sourceFilePath);
    importersByStylesheetPath.set(stylesheetPath, importers);
  }

  return new Map(
    [...importersByStylesheetPath.entries()].map(([stylesheetPath, importers]) => [
      stylesheetPath,
      [...importers].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

export function collectLocalStylesheetImportRecords(input: {
  stylesheets: ReachabilityStylesheetInput[];
  knownCssFilePaths: Set<string>;
}): StylesheetImportRecord[] {
  const imports: StylesheetImportRecord[] = [];

  for (const stylesheet of input.stylesheets) {
    const importerFilePath = normalizeProjectPath(stylesheet.filePath);
    if (!importerFilePath) {
      continue;
    }

    for (const specifier of extractCssImportSpecifiers(stylesheet.cssText ?? "")) {
      const resolvedFilePath = resolveCssImportPath({
        fromFilePath: importerFilePath,
        specifier,
        knownCssFilePaths: input.knownCssFilePaths,
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

  return imports.sort(compareStylesheetImportRecords);
}

export function applyStylesheetImportReachability(input: {
  stylesheets: StylesheetReachabilityRecord[];
  localCssImports: StylesheetImportRecord[];
  packageCssImports: ExternalCssSummary["packageCssImports"];
  includeTraces: boolean;
}): StylesheetReachabilityRecord[] {
  const stylesheetRecordsByPath = new Map(
    input.stylesheets
      .map((stylesheet) => [
        stylesheet.cssFilePath ? normalizeProjectPath(stylesheet.cssFilePath) : undefined,
        stylesheet,
      ])
      .filter(
        (entry): entry is [string, StylesheetReachabilityRecord] => typeof entry[0] === "string",
      ),
  );
  const stylesheetImports = [
    ...input.localCssImports,
    ...input.packageCssImports
      .filter((importRecord) => importRecord.importerKind === "stylesheet")
      .map((importRecord) => ({
        importerFilePath:
          normalizeProjectPath(importRecord.importerFilePath) ?? importRecord.importerFilePath,
        specifier: importRecord.specifier,
        resolvedFilePath:
          normalizeProjectPath(importRecord.resolvedFilePath) ?? importRecord.resolvedFilePath,
      })),
  ].sort(compareStylesheetImportRecords);

  let changed = true;
  let remainingIterations = stylesheetImports.length + input.stylesheets.length + 1;
  while (changed && remainingIterations > 0) {
    changed = false;
    remainingIterations -= 1;

    for (const importRecord of stylesheetImports) {
      const importer = stylesheetRecordsByPath.get(importRecord.importerFilePath);
      const imported = stylesheetRecordsByPath.get(importRecord.resolvedFilePath);
      if (!importer || !imported || importer.contexts.length === 0) {
        continue;
      }

      const contextRecordsByKey = new Map<string, StylesheetReachabilityContextRecord>();
      for (const context of imported.contexts) {
        addContextRecord(contextRecordsByKey, context, input.includeTraces);
      }
      let importedContextsChanged = false;
      for (const context of importer.contexts) {
        importedContextsChanged =
          addContextRecord(
            contextRecordsByKey,
            {
              context: context.context,
              availability: context.availability,
              reasons: [
                `stylesheet is imported by reachable stylesheet ${importRecord.importerFilePath}`,
                ...context.reasons,
              ],
              derivations: [...context.derivations],
              traces: input.includeTraces ? [...context.traces] : [],
            },
            input.includeTraces,
          ) || importedContextsChanged;
      }

      if (!importedContextsChanged) {
        continue;
      }

      const contexts = [...contextRecordsByKey.values()].sort(compareContextRecords);
      const reasons = [
        `stylesheet is imported by reachable stylesheet ${importRecord.importerFilePath}`,
        `reachability is attached to ${contexts.length} explicit render context${contexts.length === 1 ? "" : "s"}`,
      ];
      const nextRecord = withStylesheetRecordTraces({
        ...imported,
        availability: getAvailabilityFromContexts(contexts),
        contexts,
        reasons,
        traces: [],
        includeTraces: input.includeTraces,
      });

      Object.assign(imported, nextRecord);
      changed = true;
    }
  }

  return input.stylesheets.sort((left, right) =>
    (left.cssFilePath ?? "").localeCompare(right.cssFilePath ?? ""),
  );
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
