import type { ResolvedScanReactCssConfig } from "../../config/types.js";
import type { ProjectFactExtractionResult } from "../../facts/types.js";
import path from "node:path";
import type { CssFileNode, ReachabilityInfo, SourceFileNode } from "../types.js";
import { collectReachableAncestors } from "./shared.js";

// Reachability is built in two passes:
// 1. walk the source import graph upward so a file can inherit CSS from importing ancestors
// 2. for each directly imported local CSS file, expand through its local @import chain
// The CSS-side expansion is memoized per CSS file path and guarded against cycles so shared
// entry stylesheets do not need to be recomputed for every source file.
export function buildImportReachability(input: {
  sourceFiles: SourceFileNode[];
  cssFiles: CssFileNode[];
  config: ResolvedScanReactCssConfig;
  facts: ProjectFactExtractionResult;
}): {
  reachabilityBySourceFile: Map<string, ReachabilityInfo>;
  renderersBySourcePath: Map<string, Set<string>>;
} {
  const { sourceFiles, cssFiles, config, facts } = input;
  const sourceFileByPath = new Map(sourceFiles.map((sourceFile) => [sourceFile.path, sourceFile]));
  const cssFileByPath = new Map(cssFiles.map((cssFile) => [cssFile.path, cssFile]));
  const transitiveLocalCssImportsByPath = new Map<string, Set<string>>();
  const importersBySourcePath = new Map<string, Set<string>>();
  const renderersBySourcePath = new Map<string, Set<string>>();
  const globalCssPaths = cssFiles
    .filter((cssFile) => cssFile.category === "global")
    .map((cssFile) => cssFile.path)
    .sort((left, right) => left.localeCompare(right));
  const projectWideExternalCssSpecifiers = getProjectWideExternalCssSpecifiers(config, facts);

  for (const sourceFile of sourceFiles) {
    for (const sourceImport of sourceFile.sourceImports) {
      const importedSourcePath = sourceImport.resolvedPath;
      if (!importedSourcePath || !sourceFileByPath.has(importedSourcePath)) {
        continue;
      }

      const importers = importersBySourcePath.get(importedSourcePath) ?? new Set<string>();
      importers.add(sourceFile.path);
      importersBySourcePath.set(importedSourcePath, importers);
    }

    for (const renderedComponent of sourceFile.renderedComponents) {
      if (!sourceFileByPath.has(renderedComponent.resolvedPath)) {
        continue;
      }

      const renderers =
        renderersBySourcePath.get(renderedComponent.resolvedPath) ?? new Set<string>();
      renderers.add(sourceFile.path);
      renderersBySourcePath.set(renderedComponent.resolvedPath, renderers);
    }
  }

  const reachabilityBySourceFile = new Map<string, ReachabilityInfo>();

  for (const sourceFile of sourceFiles) {
    const reachableSources = collectReachableAncestors(sourceFile.path, importersBySourcePath);
    const directLocalCss = collectDirectImportedLocalCss(sourceFile, cssFileByPath);
    const reachableLocalCss = expandLocalCssImports(
      directLocalCss,
      cssFileByPath,
      transitiveLocalCssImportsByPath,
    );
    const importContextLocalCss = new Set<string>();
    const localCss = new Set<string>(reachableLocalCss);
    const externalCss = new Set<string>();

    for (const externalImport of sourceFile.externalCssImports) {
      externalCss.add(externalImport.specifier);
    }

    for (const reachableSourcePath of reachableSources) {
      const reachableSource = sourceFileByPath.get(reachableSourcePath);
      if (!reachableSource) {
        continue;
      }

      const reachableAncestorLocalCss = expandLocalCssImports(
        collectDirectImportedLocalCss(reachableSource, cssFileByPath),
        cssFileByPath,
        transitiveLocalCssImportsByPath,
      );

      for (const cssPath of reachableAncestorLocalCss) {
        if (!directLocalCss.has(cssPath)) {
          importContextLocalCss.add(cssPath);
          localCss.add(cssPath);
        }
      }

      for (const externalImport of reachableSource.externalCssImports) {
        externalCss.add(externalImport.specifier);
      }
    }

    for (const externalCssSpecifier of projectWideExternalCssSpecifiers) {
      externalCss.add(externalCssSpecifier);
    }

    reachabilityBySourceFile.set(sourceFile.path, {
      directLocalCss: new Set([...directLocalCss].sort((left, right) => left.localeCompare(right))),
      importContextLocalCss: new Set(
        [...importContextLocalCss].sort((left, right) => left.localeCompare(right)),
      ),
      localCss: new Set([...localCss].sort((left, right) => left.localeCompare(right))),
      renderContextDefiniteLocalCss: new Set(),
      renderContextPossibleLocalCss: new Set(),
      globalCss: new Set(globalCssPaths),
      externalCss: new Set([...externalCss].sort((left, right) => left.localeCompare(right))),
    });
  }

  return {
    reachabilityBySourceFile,
    renderersBySourcePath,
  };
}

function getProjectWideExternalCssSpecifiers(
  config: ResolvedScanReactCssConfig,
  facts: ProjectFactExtractionResult,
): string[] {
  if (!config.externalCss.enabled) {
    return [];
  }

  if (config.externalCss.mode !== "fetch-remote") {
    return [];
  }

  return [
    ...new Set(
      facts.htmlFacts
        .flatMap((htmlFact) => htmlFact.stylesheetLinks)
        .filter((stylesheetLink) => stylesheetLink.isRemote)
        .map((stylesheetLink) => stylesheetLink.href),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function collectDirectImportedLocalCss(
  sourceFile: SourceFileNode,
  cssFileByPath: Map<string, CssFileNode>,
): Set<string> {
  const localCss = new Set<string>();

  for (const cssImport of sourceFile.cssImports) {
    const cssPath = cssImport.resolvedPath ?? cssImport.specifier;
    const cssFile = cssFileByPath.get(cssPath);
    if (!cssFile || cssFile.category === "global") {
      continue;
    }

    localCss.add(cssFile.path);
  }

  for (const cssModuleImport of sourceFile.cssModuleImports) {
    if (cssModuleImport.resolvedPath) {
      localCss.add(cssModuleImport.resolvedPath);
    }
  }

  return localCss;
}

function expandLocalCssImports(
  cssPaths: Set<string>,
  cssFileByPath: Map<string, CssFileNode>,
  transitiveLocalCssImportsByPath: Map<string, Set<string>>,
): Set<string> {
  const reachableCss = new Set<string>();

  for (const cssPath of cssPaths) {
    reachableCss.add(cssPath);

    for (const importedCssPath of collectTransitiveLocalCssImports(
      cssPath,
      cssFileByPath,
      transitiveLocalCssImportsByPath,
    )) {
      reachableCss.add(importedCssPath);
    }
  }

  return new Set([...reachableCss].sort((left, right) => left.localeCompare(right)));
}

function collectTransitiveLocalCssImports(
  cssPath: string,
  cssFileByPath: Map<string, CssFileNode>,
  transitiveLocalCssImportsByPath: Map<string, Set<string>>,
  activePath = new Set<string>(),
): Set<string> {
  const cached = transitiveLocalCssImportsByPath.get(cssPath);
  if (cached) {
    return cached;
  }

  if (activePath.has(cssPath)) {
    return new Set();
  }

  activePath.add(cssPath);

  const cssFile = cssFileByPath.get(cssPath);
  const transitiveImports = new Set<string>();

  if (cssFile) {
    for (const cssImport of cssFile.imports) {
      if (cssImport.isExternal) {
        continue;
      }

      const importedCssPath = resolveLocalCssImport(cssFile.path, cssImport.specifier);
      const importedCssFile = importedCssPath ? cssFileByPath.get(importedCssPath) : undefined;
      if (!importedCssFile || importedCssFile.category === "global") {
        continue;
      }

      transitiveImports.add(importedCssFile.path);

      for (const nestedImport of collectTransitiveLocalCssImports(
        importedCssFile.path,
        cssFileByPath,
        transitiveLocalCssImportsByPath,
        activePath,
      )) {
        transitiveImports.add(nestedImport);
      }
    }
  }

  activePath.delete(cssPath);

  const sortedImports = new Set(
    [...transitiveImports].sort((left, right) => left.localeCompare(right)),
  );
  transitiveLocalCssImportsByPath.set(cssPath, sortedImports);
  return sortedImports;
}

function resolveLocalCssImport(cssFilePath: string, specifier: string): string | undefined {
  const normalizedSpecifier = specifier.split("\\").join("/");

  if (normalizedSpecifier.startsWith("/")) {
    return path.posix.normalize(normalizedSpecifier.slice(1));
  }

  if (!normalizedSpecifier.startsWith(".")) {
    return undefined;
  }

  return path.posix.normalize(
    path.posix.join(path.posix.dirname(cssFilePath), normalizedSpecifier),
  );
}
