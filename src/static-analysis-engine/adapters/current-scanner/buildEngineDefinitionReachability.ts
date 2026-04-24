import type { ProjectModel } from "../../../model/types.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/types.js";
import type { ModuleGraph } from "../../pipeline/module-graph/types.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/types.js";
import { buildEngineRenderContextReachabilityBySourceFile } from "./buildEngineRenderContextReachability.js";

export type EngineDefinitionReachabilityInfo = {
  directLocalCss: Set<string>;
  importContextLocalCss: Set<string>;
  renderContextDefiniteLocalCss: Set<string>;
  renderContextPossibleLocalCss: Set<string>;
  globalCss: Set<string>;
  externalCss: Set<string>;
};

export function buildEngineDefinitionReachabilityBySourceFile(input: {
  model: ProjectModel;
  moduleGraph: ModuleGraph;
  reachabilitySummary: ReachabilitySummary;
  externalCssSummary: ExternalCssSummary;
}): Map<string, EngineDefinitionReachabilityInfo> {
  const { model, moduleGraph, externalCssSummary, reachabilitySummary } = input;
  const renderContextReachabilityBySourceFile = buildEngineRenderContextReachabilityBySourceFile(
    model,
    reachabilitySummary,
  );
  const knownLocalCssFilePaths = new Set(
    model.graph.cssFiles
      .map((cssFile) => normalizeProjectPath(cssFile.path))
      .filter(Boolean) as string[],
  );
  const cssFilesByPath = new Map(
    model.graph.cssFiles.map((cssFile) => [
      normalizeProjectPath(cssFile.path) ?? cssFile.path,
      cssFile,
    ]),
  );
  const directLocalCssBySourceFile = new Map<string, Set<string>>();
  const directExternalCssBySourceFile = new Map<string, Set<string>>();
  const importersBySourcePath = new Map<string, Set<string>>();
  const transitiveLocalCssImportsByPath = new Map<string, Set<string>>();
  const globalCssPaths = model.graph.cssFiles
    .filter((cssFile) => cssFile.category === "global")
    .map((cssFile) => normalizeProjectPath(cssFile.path) ?? cssFile.path)
    .sort((left, right) => left.localeCompare(right));
  const projectWideExternalCssSpecifiers = externalCssSummary.projectWideStylesheetFilePaths
    .map((filePath) => normalizeProjectPath(filePath) ?? filePath)
    .sort((left, right) => left.localeCompare(right));

  for (const moduleNode of moduleGraph.modulesById.values()) {
    if (moduleNode.kind !== "source") {
      continue;
    }

    const sourceFilePath = normalizeProjectPath(moduleNode.filePath) ?? moduleNode.filePath;
    const directLocalCss = directLocalCssBySourceFile.get(sourceFilePath) ?? new Set<string>();
    const directExternalCss =
      directExternalCssBySourceFile.get(sourceFilePath) ?? new Set<string>();

    for (const importRecord of moduleNode.imports) {
      if (importRecord.importKind === "source" && importRecord.resolvedModuleId) {
        const importedModule = moduleGraph.modulesById.get(importRecord.resolvedModuleId);
        if (importedModule?.kind === "source") {
          const importedSourceFilePath =
            normalizeProjectPath(importedModule.filePath) ?? importedModule.filePath;
          const importers = importersBySourcePath.get(importedSourceFilePath) ?? new Set<string>();
          importers.add(sourceFilePath);
          importersBySourcePath.set(importedSourceFilePath, importers);
        }
        continue;
      }

      if (importRecord.importKind === "css") {
        const cssFilePath = resolveCssImportPath({
          fromFilePath: sourceFilePath,
          specifier: importRecord.specifier,
          knownCssFilePaths: knownLocalCssFilePaths,
        });
        if (!cssFilePath) {
          continue;
        }

        const cssFile = cssFilesByPath.get(cssFilePath);
        if (!cssFile || cssFile.category === "global") {
          continue;
        }

        directLocalCss.add(cssFilePath);
        continue;
      }

      if (importRecord.importKind === "external-css") {
        directExternalCss.add(
          normalizeProjectPath(importRecord.specifier) ?? importRecord.specifier,
        );
      }
    }

    directLocalCssBySourceFile.set(sourceFilePath, directLocalCss);
    directExternalCssBySourceFile.set(sourceFilePath, directExternalCss);
  }

  const reachabilityBySourceFile = new Map<string, EngineDefinitionReachabilityInfo>();
  for (const sourceFile of model.graph.sourceFiles) {
    const sourceFilePath = normalizeProjectPath(sourceFile.path) ?? sourceFile.path;
    const directLocalCss = new Set(directLocalCssBySourceFile.get(sourceFilePath) ?? []);
    const importContextLocalCss = new Set<string>();
    const externalCss = new Set(directExternalCssBySourceFile.get(sourceFilePath) ?? []);
    const reachableAncestorSourceFilePaths = collectReachableAncestors(
      sourceFilePath,
      importersBySourcePath,
    );

    for (const ancestorSourceFilePath of reachableAncestorSourceFilePaths) {
      const reachableAncestorLocalCss = expandLocalCssImports({
        cssPaths: directLocalCssBySourceFile.get(ancestorSourceFilePath) ?? new Set<string>(),
        cssFilesByPath,
        transitiveLocalCssImportsByPath,
      });

      for (const cssFilePath of reachableAncestorLocalCss) {
        if (!directLocalCss.has(cssFilePath)) {
          importContextLocalCss.add(cssFilePath);
        }
      }

      for (const externalCssSpecifier of directExternalCssBySourceFile.get(
        ancestorSourceFilePath,
      ) ?? []) {
        externalCss.add(externalCssSpecifier);
      }
    }

    for (const projectWideExternalCssSpecifier of projectWideExternalCssSpecifiers) {
      externalCss.add(projectWideExternalCssSpecifier);
    }

    const renderContextReachability = renderContextReachabilityBySourceFile.get(sourceFilePath);
    reachabilityBySourceFile.set(sourceFilePath, {
      directLocalCss: new Set([...directLocalCss].sort((left, right) => left.localeCompare(right))),
      importContextLocalCss: new Set(
        [...importContextLocalCss].sort((left, right) => left.localeCompare(right)),
      ),
      renderContextDefiniteLocalCss: new Set(
        [...(renderContextReachability?.renderContextDefiniteLocalCss ?? [])].sort((left, right) =>
          left.localeCompare(right),
        ),
      ),
      renderContextPossibleLocalCss: new Set(
        [...(renderContextReachability?.renderContextPossibleLocalCss ?? [])].sort((left, right) =>
          left.localeCompare(right),
        ),
      ),
      globalCss: new Set(globalCssPaths),
      externalCss: new Set([...externalCss].sort((left, right) => left.localeCompare(right))),
    });
  }

  return reachabilityBySourceFile;
}

function collectReachableAncestors(
  sourceFilePath: string,
  importersBySourcePath: Map<string, Set<string>>,
): string[] {
  const visited = new Set<string>();
  const queue = [...(importersBySourcePath.get(sourceFilePath) ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    const nextAncestors = [...(importersBySourcePath.get(current) ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
    queue.push(...nextAncestors);
  }

  return [...visited].sort((left, right) => left.localeCompare(right));
}

function expandLocalCssImports(input: {
  cssPaths: Set<string>;
  cssFilesByPath: Map<string, ProjectModel["graph"]["cssFiles"][number]>;
  transitiveLocalCssImportsByPath: Map<string, Set<string>>;
}): Set<string> {
  const reachableCss = new Set<string>();

  for (const cssPath of input.cssPaths) {
    reachableCss.add(cssPath);

    for (const importedCssPath of collectTransitiveLocalCssImports({
      cssPath,
      cssFilesByPath: input.cssFilesByPath,
      transitiveLocalCssImportsByPath: input.transitiveLocalCssImportsByPath,
    })) {
      reachableCss.add(importedCssPath);
    }
  }

  return new Set([...reachableCss].sort((left, right) => left.localeCompare(right)));
}

function collectTransitiveLocalCssImports(input: {
  cssPath: string;
  cssFilesByPath: Map<string, ProjectModel["graph"]["cssFiles"][number]>;
  transitiveLocalCssImportsByPath: Map<string, Set<string>>;
  activePath?: Set<string>;
}): Set<string> {
  const cached = input.transitiveLocalCssImportsByPath.get(input.cssPath);
  if (cached) {
    return cached;
  }

  const activePath = input.activePath ?? new Set<string>();
  if (activePath.has(input.cssPath)) {
    return new Set();
  }

  activePath.add(input.cssPath);
  const cssFile = input.cssFilesByPath.get(input.cssPath);
  const transitiveImports = new Set<string>();

  if (cssFile) {
    for (const cssImport of cssFile.imports) {
      if (cssImport.isExternal) {
        continue;
      }

      const importedCssPath = resolveCssImportPath({
        fromFilePath: input.cssPath,
        specifier: cssImport.specifier,
        knownCssFilePaths: new Set(input.cssFilesByPath.keys()),
      });
      const importedCssFile = importedCssPath
        ? input.cssFilesByPath.get(importedCssPath)
        : undefined;
      if (!importedCssFile || importedCssFile.category === "global") {
        continue;
      }

      const normalizedImportedCssPath =
        normalizeProjectPath(importedCssFile.path) ?? importedCssFile.path;
      transitiveImports.add(normalizedImportedCssPath);

      for (const nestedImport of collectTransitiveLocalCssImports({
        cssPath: normalizedImportedCssPath,
        cssFilesByPath: input.cssFilesByPath,
        transitiveLocalCssImportsByPath: input.transitiveLocalCssImportsByPath,
        activePath,
      })) {
        transitiveImports.add(nestedImport);
      }
    }
  }

  activePath.delete(input.cssPath);
  const sortedImports = new Set(
    [...transitiveImports].sort((left, right) => left.localeCompare(right)),
  );
  input.transitiveLocalCssImportsByPath.set(input.cssPath, sortedImports);
  return sortedImports;
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
