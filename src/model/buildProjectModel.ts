import path from "node:path";
import type { ResolvedReactCssScannerConfig } from "../config/types.js";
import type { ProjectFactExtractionResult } from "../facts/types.js";
import { matchesAnyGlob, normalizePathForMatch } from "../files/pathUtils.js";
import type {
  BuildProjectModelInput,
  CssFileNode,
  CssOwnership,
  CssResourceCategory,
  ExternalCssResourceNode,
  ProjectGraphEdge,
  ProjectIndexes,
  ProjectModel,
  ReachabilityInfo,
  SourceFileNode,
} from "./types.js";

export function buildProjectModel({ config, facts }: BuildProjectModelInput): ProjectModel {
  const sourceFiles = buildSourceFileNodes(facts.sourceFacts);
  const sourceFileByPath = new Map(sourceFiles.map((sourceFile) => [sourceFile.path, sourceFile]));

  const cssFiles = buildCssFileNodes(facts, config, sourceFileByPath);
  const externalCssResources = buildExternalCssResources(sourceFiles, facts, config);
  const activeExternalCssProviders = buildActiveExternalCssProviders(config, facts);
  const edges = buildGraphEdges(sourceFiles, cssFiles, externalCssResources);
  const reachability = buildReachability(
    sourceFiles,
    cssFiles,
    getProjectWideExternalCssSpecifiers(config, facts),
  );
  const indexes = buildProjectIndexes(
    sourceFiles,
    cssFiles,
    externalCssResources,
    activeExternalCssProviders,
    reachability,
  );

  return {
    config,
    facts,
    graph: {
      sourceFiles,
      cssFiles,
      externalCssResources,
      edges,
    },
    indexes,
    reachability,
  };
}

function buildSourceFileNodes(
  sourceFacts: ProjectFactExtractionResult["sourceFacts"],
): SourceFileNode[] {
  return sourceFacts
    .map((fact) => ({
      path: fact.filePath,
      sourceImports: fact.imports.filter((item) => item.kind === "source"),
      cssImports: fact.imports.filter((item) => item.kind === "css"),
      externalCssImports: fact.imports.filter((item) => item.kind === "external-css"),
      cssModuleImports: [...fact.cssModuleImports],
      classReferences: [...fact.classReferences],
      helperImports: [...fact.helperImports],
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function buildCssFileNodes(
  facts: ProjectFactExtractionResult,
  config: ResolvedReactCssScannerConfig,
  sourceFileByPath: Map<string, SourceFileNode>,
): CssFileNode[] {
  return facts.cssFacts
    .map((fact) => {
      const ownership = classifyCssOwnership(fact.filePath, config, sourceFileByPath);
      const category = classifyCssCategory(ownership);

      return {
        path: fact.filePath,
        ownership,
        category,
        styleRules: [...fact.styleRules],
        classDefinitions: [...fact.classDefinitions],
        imports: [...fact.imports],
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function buildExternalCssResources(
  sourceFiles: SourceFileNode[],
  facts: ProjectFactExtractionResult,
  config: ResolvedReactCssScannerConfig,
): ExternalCssResourceNode[] {
  const resources = new Map<string, ExternalCssResourceNode>();
  const externalFactsBySpecifier = new Map(
    facts.externalCssFacts.map((externalFact) => [externalFact.specifier, externalFact]),
  );

  for (const sourceFile of sourceFiles) {
    for (const externalImport of sourceFile.externalCssImports) {
      const existing = resources.get(externalImport.specifier);
      if (existing) {
        existing.importedBy.push(sourceFile.path);
        existing.importedBy.sort((left, right) => left.localeCompare(right));
        continue;
      }

      const externalFact = externalFactsBySpecifier.get(externalImport.specifier);
      resources.set(externalImport.specifier, {
        specifier: externalImport.specifier,
        resolvedPath:
          externalFact?.resolvedPath ?? externalImport.resolvedPath ?? externalImport.specifier,
        importedBy: [sourceFile.path],
        category: "external",
        ownership: "external",
        styleRules: [...(externalFact?.styleRules ?? [])],
        classDefinitions: [...(externalFact?.classDefinitions ?? [])],
        imports: [...(externalFact?.imports ?? [])],
      });
    }
  }

  if (config.externalCss.enabled && config.externalCss.mode === "fetch-remote") {
    for (const htmlFact of facts.htmlFacts) {
      for (const stylesheetLink of htmlFact.stylesheetLinks) {
        const externalFact = externalFactsBySpecifier.get(stylesheetLink.href);
        if (!externalFact) {
          continue;
        }

        const existing = resources.get(stylesheetLink.href);
        if (existing) {
          continue;
        }

        resources.set(stylesheetLink.href, {
          specifier: stylesheetLink.href,
          resolvedPath: externalFact.resolvedPath,
          importedBy: [],
          category: "external",
          ownership: "external",
          styleRules: [...externalFact.styleRules],
          classDefinitions: [...externalFact.classDefinitions],
          imports: [...externalFact.imports],
        });
      }
    }
  }

  return [...resources.values()].sort((left, right) =>
    left.specifier.localeCompare(right.specifier),
  );
}

function buildActiveExternalCssProviders(
  config: ResolvedReactCssScannerConfig,
  facts: ProjectFactExtractionResult,
) {
  const activeProviders = new Map<
    string,
    {
      provider: string;
      match: string[];
      classPrefixes: string[];
      classNames: string[];
      matchedStylesheets: Array<{
        filePath: string;
        href: string;
        isRemote: boolean;
      }>;
    }
  >();

  if (
    !config.externalCss.enabled ||
    (config.externalCss.mode !== "declared-globals" && config.externalCss.mode !== "fetch-remote")
  ) {
    return activeProviders;
  }

  for (const htmlFact of facts.htmlFacts) {
    for (const stylesheetLink of htmlFact.stylesheetLinks) {
      for (const provider of config.externalCss.globals) {
        if (!matchesAnyGlob(stylesheetLink.href, provider.match)) {
          continue;
        }

        const existingProvider = activeProviders.get(provider.provider);
        if (existingProvider) {
          existingProvider.matchedStylesheets.push({
            filePath: htmlFact.filePath,
            href: stylesheetLink.href,
            isRemote: stylesheetLink.isRemote,
          });
          existingProvider.matchedStylesheets.sort((left, right) => {
            if (left.filePath === right.filePath) {
              return left.href.localeCompare(right.href);
            }

            return left.filePath.localeCompare(right.filePath);
          });
          continue;
        }

        activeProviders.set(provider.provider, {
          provider: provider.provider,
          match: [...provider.match],
          classPrefixes: [...provider.classPrefixes],
          classNames: [...provider.classNames],
          matchedStylesheets: [
            {
              filePath: htmlFact.filePath,
              href: stylesheetLink.href,
              isRemote: stylesheetLink.isRemote,
            },
          ],
        });
      }
    }
  }

  return activeProviders;
}

function buildGraphEdges(
  sourceFiles: SourceFileNode[],
  cssFiles: CssFileNode[],
  externalCssResources: ExternalCssResourceNode[],
): ProjectGraphEdge[] {
  const edges: ProjectGraphEdge[] = [];

  for (const sourceFile of sourceFiles) {
    for (const sourceImport of sourceFile.sourceImports) {
      edges.push({
        type: "source-import",
        from: sourceFile.path,
        to: sourceImport.resolvedPath ?? sourceImport.specifier,
      });
    }

    for (const cssImport of sourceFile.cssImports) {
      edges.push({
        type: "css-import",
        from: sourceFile.path,
        to: cssImport.resolvedPath ?? cssImport.specifier,
      });
    }

    for (const externalImport of sourceFile.externalCssImports) {
      edges.push({
        type: "external-css-import",
        from: sourceFile.path,
        to: externalImport.specifier,
      });
    }

    for (const cssModuleImport of sourceFile.cssModuleImports) {
      edges.push({
        type: "css-module-import",
        from: sourceFile.path,
        to: cssModuleImport.resolvedPath ?? cssModuleImport.specifier,
        metadata: {
          localName: cssModuleImport.localName,
        },
      });
    }

    for (const classReference of sourceFile.classReferences) {
      if (!classReference.className) {
        continue;
      }

      edges.push({
        type: "class-reference",
        from: sourceFile.path,
        to: classReference.className,
        metadata: {
          kind: classReference.kind,
          confidence: classReference.confidence,
        },
      });
    }
  }

  for (const cssFile of cssFiles) {
    for (const definition of cssFile.classDefinitions) {
      edges.push({
        type: "class-definition",
        from: cssFile.path,
        to: definition.className,
        metadata: {
          selector: definition.selector,
          ownership: cssFile.ownership,
          category: cssFile.category,
        },
      });
    }
  }

  for (const externalCssResource of externalCssResources) {
    for (const importedBy of externalCssResource.importedBy) {
      edges.push({
        type: "external-css-import",
        from: importedBy,
        to: externalCssResource.specifier,
      });
    }

    for (const definition of externalCssResource.classDefinitions) {
      edges.push({
        type: "class-definition",
        from: externalCssResource.resolvedPath,
        to: definition.className,
        metadata: {
          selector: definition.selector,
          ownership: "external",
          category: "external",
          externalSpecifier: externalCssResource.specifier,
        },
      });
    }
  }

  return edges.sort(compareGraphEdges);
}

function buildProjectIndexes(
  sourceFiles: SourceFileNode[],
  cssFiles: CssFileNode[],
  externalCssResources: ExternalCssResourceNode[],
  activeExternalCssProviders: Map<
    string,
    ProjectIndexes["activeExternalCssProviders"] extends Map<string, infer V> ? V : never
  >,
  reachability: Map<string, ReachabilityInfo>,
): ProjectIndexes {
  const sourceFileByPath = new Map(sourceFiles.map((sourceFile) => [sourceFile.path, sourceFile]));
  const cssFileByPath = new Map(cssFiles.map((cssFile) => [cssFile.path, cssFile]));
  const externalCssBySpecifier = new Map(
    externalCssResources.map((resource) => [resource.specifier, resource]),
  );
  const classDefinitionsByName = new Map<
    string,
    ProjectIndexes["classDefinitionsByName"] extends Map<string, infer V> ? V : never
  >();
  const classReferencesByName = new Map<
    string,
    ProjectIndexes["classReferencesByName"] extends Map<string, infer V> ? V : never
  >();
  const cssModuleImportsBySourceFile = new Map<string, SourceFileNode["cssModuleImports"]>();

  for (const sourceFile of sourceFiles) {
    cssModuleImportsBySourceFile.set(sourceFile.path, [...sourceFile.cssModuleImports]);

    for (const reference of sourceFile.classReferences) {
      if (!reference.className) {
        continue;
      }

      const existingReferences = classReferencesByName.get(reference.className) ?? [];
      existingReferences.push({
        sourceFile: sourceFile.path,
        reference,
      });
      existingReferences.sort((left, right) => left.sourceFile.localeCompare(right.sourceFile));
      classReferencesByName.set(reference.className, existingReferences);
    }
  }

  for (const cssFile of cssFiles) {
    for (const definition of cssFile.classDefinitions) {
      const existingDefinitions = classDefinitionsByName.get(definition.className) ?? [];
      existingDefinitions.push({
        cssFile: cssFile.path,
        ownership: cssFile.ownership,
        category: cssFile.category,
        definition,
      });
      existingDefinitions.sort((left, right) => left.cssFile.localeCompare(right.cssFile));
      classDefinitionsByName.set(definition.className, existingDefinitions);
    }
  }

  for (const externalCssResource of externalCssResources) {
    for (const definition of externalCssResource.classDefinitions) {
      const existingDefinitions = classDefinitionsByName.get(definition.className) ?? [];
      existingDefinitions.push({
        cssFile: externalCssResource.resolvedPath,
        externalSpecifier: externalCssResource.specifier,
        ownership: "external",
        category: "external",
        definition,
      });
      existingDefinitions.sort((left, right) => left.cssFile.localeCompare(right.cssFile));
      classDefinitionsByName.set(definition.className, existingDefinitions);
    }
  }

  return {
    sourceFileByPath,
    cssFileByPath,
    externalCssBySpecifier,
    activeExternalCssProviders,
    classDefinitionsByName,
    classReferencesByName,
    reachabilityBySourceFile: reachability,
    cssModuleImportsBySourceFile,
  };
}

function buildReachability(
  sourceFiles: SourceFileNode[],
  cssFiles: CssFileNode[],
  projectWideExternalCssSpecifiers: string[],
): Map<string, ReachabilityInfo> {
  const sourceFileByPath = new Map(sourceFiles.map((sourceFile) => [sourceFile.path, sourceFile]));
  const cssFileByPath = new Map(cssFiles.map((cssFile) => [cssFile.path, cssFile]));
  const importersBySourcePath = new Map<string, Set<string>>();
  const globalCssPaths = cssFiles
    .filter((cssFile) => cssFile.category === "global")
    .map((cssFile) => cssFile.path)
    .sort((left, right) => left.localeCompare(right));

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
  }

  const reachabilityBySourceFile = new Map<string, ReachabilityInfo>();

  for (const sourceFile of sourceFiles) {
    const reachableSources = collectReachableImporterChain(sourceFile.path, importersBySourcePath);
    reachableSources.add(sourceFile.path);

    const localCss = new Set<string>();
    const externalCss = new Set<string>();

    for (const reachableSourcePath of reachableSources) {
      const reachableSource = sourceFileByPath.get(reachableSourcePath);
      if (!reachableSource) {
        continue;
      }

      for (const cssImport of reachableSource.cssImports) {
        const cssPath = cssImport.resolvedPath ?? cssImport.specifier;
        const cssFile = cssFileByPath.get(cssPath);
        if (!cssFile) {
          continue;
        }

        if (cssFile.category === "global") {
          continue;
        }

        localCss.add(cssFile.path);
      }

      for (const cssModuleImport of reachableSource.cssModuleImports) {
        if (cssModuleImport.resolvedPath) {
          localCss.add(cssModuleImport.resolvedPath);
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
      localCss: new Set([...localCss].sort((left, right) => left.localeCompare(right))),
      globalCss: new Set(globalCssPaths),
      externalCss: new Set([...externalCss].sort((left, right) => left.localeCompare(right))),
    });
  }

  return reachabilityBySourceFile;
}

function getProjectWideExternalCssSpecifiers(
  config: ResolvedReactCssScannerConfig,
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

function collectReachableImporterChain(
  sourceFilePath: string,
  importersBySourcePath: Map<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>();
  const queue = [...(importersBySourcePath.get(sourceFilePath) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const importer of importersBySourcePath.get(current) ?? []) {
      if (!visited.has(importer)) {
        queue.push(importer);
      }
    }
  }

  return visited;
}

function classifyCssOwnership(
  filePath: string,
  config: ResolvedReactCssScannerConfig,
  sourceFileByPath: Map<string, SourceFileNode>,
): CssOwnership {
  const normalizedPath = normalizePathForMatch(filePath);

  // Deterministic precedence:
  // 1. explicit global patterns
  // 2. explicit utility patterns
  // 3. explicit page patterns
  // 4. explicit component patterns
  // 5. optional sibling naming convention
  // 6. otherwise unclassified
  if (matchesAnyGlob(normalizedPath, config.css.global)) {
    return "global";
  }

  if (matchesAnyGlob(normalizedPath, config.css.utilities)) {
    return "utility";
  }

  if (matchesAnyGlob(normalizedPath, config.ownership.pagePatterns)) {
    return "page";
  }

  if (matchesAnyGlob(normalizedPath, config.ownership.componentCssPatterns)) {
    return "component";
  }

  if (
    config.ownership.namingConvention === "sibling" &&
    hasSiblingSourceMatch(normalizedPath, sourceFileByPath)
  ) {
    return "component";
  }

  return "unclassified";
}

function classifyCssCategory(ownership: CssOwnership): CssResourceCategory {
  if (ownership === "global") {
    return "global";
  }

  if (ownership === "external") {
    return "external";
  }

  return "local";
}

function hasSiblingSourceMatch(
  cssFilePath: string,
  sourceFileByPath: Map<string, SourceFileNode>,
): boolean {
  const cssBaseName = path.basename(cssFilePath, path.extname(cssFilePath));
  const cssDirectory = normalizePathForMatch(path.dirname(cssFilePath));

  for (const sourceFilePath of sourceFileByPath.keys()) {
    const sourceDirectory = normalizePathForMatch(path.dirname(sourceFilePath));
    const sourceBaseName = path.basename(sourceFilePath, path.extname(sourceFilePath));

    if (cssDirectory === sourceDirectory && cssBaseName === sourceBaseName) {
      return true;
    }
  }

  return false;
}

function compareGraphEdges(left: ProjectGraphEdge, right: ProjectGraphEdge): number {
  if (left.type !== right.type) {
    return left.type.localeCompare(right.type);
  }

  if (left.from !== right.from) {
    return left.from.localeCompare(right.from);
  }

  return left.to.localeCompare(right.to);
}
