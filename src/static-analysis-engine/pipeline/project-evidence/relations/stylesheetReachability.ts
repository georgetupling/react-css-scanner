import type { ReachabilityAvailability } from "../analysisTypes.js";
import type {
  ClassReferenceAnalysis,
  ProjectEvidenceBuildInput,
  ProjectEvidenceId,
  ProjectEvidenceBuilderIndexes,
  StylesheetReachabilityRelation,
  StylesheetReachabilityContextRecord,
} from "../analysisTypes.js";
import {
  compareReachabilityRelations,
  createComponentKey,
  createReachabilityContextKey,
  normalizeProjectPath,
  pushUniqueMapValue,
  sortIndexValues,
  mergeTraces,
} from "../internal/shared.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SelectorBranchMatch } from "../../selector-reachability/types.js";
import type { ProjectResourceEdge } from "../../workspace-discovery/index.js";

export function buildStylesheetReachability(
  input: ProjectEvidenceBuildInput,
  indexes: ProjectEvidenceBuilderIndexes,
  includeTraces: boolean,
): StylesheetReachabilityRelation[] {
  const relations: StylesheetReachabilityRelation[] = [];

  for (const stylesheet of collectStylesheetReachabilityEvidence(input)) {
    const stylesheetId = indexes.stylesheetIdByPath.get(
      normalizeProjectPath(stylesheet.cssFilePath ?? ""),
    );
    if (!stylesheetId) {
      continue;
    }

    if (stylesheet.contexts.length === 0) {
      relations.push({
        stylesheetId,
        availability: stylesheet.availability,
        contexts: [],
        reasons: [...stylesheet.reasons],
        traces: includeTraces ? [...stylesheet.traces] : [],
      });
      continue;
    }

    for (const contextRecord of stylesheet.contexts) {
      const sourceFileId = getSourceFileIdForContext(contextRecord, indexes);
      const componentId = getComponentIdForContext(contextRecord, indexes);
      const relation: StylesheetReachabilityRelation = {
        stylesheetId,
        sourceFileId,
        componentId,
        availability: contextRecord.availability,
        contexts: [contextRecord],
        reasons: [...contextRecord.reasons],
        traces: includeTraces ? [...contextRecord.traces] : [],
      };

      relations.push(relation);

      if (contextRecord.availability !== "unavailable") {
        if (sourceFileId) {
          pushUniqueMapValue(
            indexes.reachableStylesheetsBySourceFileId,
            sourceFileId,
            stylesheetId,
          );
        }
        if (componentId) {
          pushUniqueMapValue(indexes.reachableStylesheetsByComponentId, componentId, stylesheetId);
        }
      }
    }
  }

  sortIndexValues(indexes.reachableStylesheetsBySourceFileId);
  sortIndexValues(indexes.reachableStylesheetsByComponentId);
  return relations.sort(compareReachabilityRelations);
}

function collectStylesheetReachabilityEvidence(input: ProjectEvidenceBuildInput): Array<{
  cssFilePath?: string;
  availability: ReachabilityAvailability;
  contexts: StylesheetReachabilityContextRecord[];
  reasons: string[];
  traces: AnalysisTrace[];
}> {
  const graph = input.factGraph?.graph;
  if (!graph) {
    return [];
  }

  const directlyImportedByStylesheetPath = new Map<string, string[]>();
  for (const edge of graph.edges.imports) {
    if (edge.importerKind !== "source" || edge.importKind !== "css" || !edge.resolvedFilePath) {
      continue;
    }
    const stylesheetPath = normalizeProjectPath(edge.resolvedFilePath);
    pushMapValue(
      directlyImportedByStylesheetPath,
      stylesheetPath,
      normalizeProjectPath(edge.importerFilePath),
    );
  }

  const stylesheetImportersByStylesheetPath = new Map<string, string[]>();
  for (const edge of input.factGraph?.snapshot.edges ?? []) {
    if (edge.kind === "stylesheet-import" && edge.resolvedFilePath) {
      const importedPath = normalizeProjectPath(edge.resolvedFilePath);
      const importerPath = normalizeProjectPath(edge.importerFilePath);
      pushMapValue(stylesheetImportersByStylesheetPath, importedPath, importerPath);
      continue;
    }
    if (
      edge.kind === "package-css-import" &&
      edge.importerKind === "stylesheet" &&
      edge.resolvedFilePath
    ) {
      const importedPath = normalizeProjectPath(edge.resolvedFilePath);
      const importerPath = normalizeProjectPath(edge.importerFilePath);
      pushMapValue(stylesheetImportersByStylesheetPath, importedPath, importerPath);
    }
  }

  const projectWideStylesheets = new Set(
    input.factGraph?.snapshot.edges
      .filter((edge) => edge.kind === "html-stylesheet")
      .map((edge) =>
        normalizeProjectPath(edge.resolvedFilePath ? edge.resolvedFilePath : edge.href),
      ) ?? [],
  );
  const packageImportedByStylesheetPath = new Map<string, string[]>();
  for (const edge of input.factGraph?.snapshot.edges ?? []) {
    if (
      edge.kind !== "package-css-import" ||
      edge.importerKind !== "source" ||
      !edge.resolvedFilePath
    ) {
      continue;
    }

    const stylesheetPath = normalizeProjectPath(edge.resolvedFilePath);
    const sourceFilePath = normalizeProjectPath(edge.importerFilePath);
    pushMapValue(packageImportedByStylesheetPath, stylesheetPath, sourceFilePath);
  }
  const importedSourcePathsBySourcePath = new Map<string, string[]>();
  for (const edge of graph.edges.imports) {
    if (
      edge.importerKind !== "source" ||
      edge.importKind !== "source" ||
      edge.importLoading !== "static" ||
      !edge.resolvedFilePath
    ) {
      continue;
    }
    const importerPath = normalizeProjectPath(edge.importerFilePath);
    const importedPath = normalizeProjectPath(edge.resolvedFilePath);
    pushMapValue(importedSourcePathsBySourcePath, importerPath, importedPath);
  }
  const sourceContextsByStylesheetPath = buildTransitiveSourceContextsByStylesheetPath({
    directlyImportedByStylesheetPath,
    stylesheetImportersByStylesheetPath,
    packageImportedByStylesheetPath,
    importedSourcePathsBySourcePath,
  });
  const entryBundleContextsByStylesheetPath = buildEntryBundleContextsByStylesheetPath({
    snapshotEdges: input.factGraph?.snapshot.edges ?? [],
    moduleFilePaths: graph.nodes.modules
      .map((moduleNode) => normalizeProjectPath(moduleNode.filePath))
      .sort((left, right) => left.localeCompare(right)),
    importedSourcePathsBySourcePath,
    directlyImportedByStylesheetPath,
    packageImportedByStylesheetPath,
    stylesheetImportersByStylesheetPath,
  });
  const selectorDerivedByStylesheetPath = collectSelectorDerivedStylesheetContexts(input);

  return graph.nodes.stylesheets.map((stylesheet) => {
    const cssFilePath = stylesheet.filePath ? normalizeProjectPath(stylesheet.filePath) : undefined;
    const selectorDerived = cssFilePath
      ? selectorDerivedByStylesheetPath.get(cssFilePath)
      : undefined;
    const contexts: StylesheetReachabilityContextRecord[] = selectorDerived
      ? [...selectorDerived.contexts]
      : [];

    if (cssFilePath) {
      for (const sourceFilePath of sourceContextsByStylesheetPath.get(cssFilePath) ?? []) {
        contexts.push({
          context: { kind: "source-file", filePath: sourceFilePath },
          availability: "definite",
          reasons: ["stylesheet is transitively imported by source file"],
          derivations: [{ kind: "source-file-direct-import" }],
          traces: [],
        });
      }

      contexts.push(...(entryBundleContextsByStylesheetPath.get(cssFilePath) ?? []));

      if (projectWideStylesheets.has(cssFilePath)) {
        for (const moduleNode of graph.nodes.modules) {
          contexts.push({
            context: { kind: "source-file", filePath: normalizeProjectPath(moduleNode.filePath) },
            availability: "definite",
            reasons: ["stylesheet is linked as project-wide CSS"],
            derivations: [
              {
                kind: "source-file-project-wide-external-css",
                stylesheetHref: cssFilePath,
              },
            ],
            traces: [],
          });
        }
      }
    }

    return {
      ...(cssFilePath ? { cssFilePath } : {}),
      availability: contexts.some((context) => context.availability === "definite")
        ? "definite"
        : contexts.some((context) => context.availability === "possible")
          ? "possible"
          : contexts.length === 0
            ? "unavailable"
            : "unknown",
      contexts,
      reasons:
        contexts.length > 0
          ? ["stylesheet has reachable project contexts"]
          : ["no reachable project context was proven"],
      traces: [],
    };
  });
}

function buildTransitiveSourceContextsByStylesheetPath(input: {
  directlyImportedByStylesheetPath: Map<string, string[]>;
  stylesheetImportersByStylesheetPath: Map<string, string[]>;
  packageImportedByStylesheetPath: Map<string, string[]>;
  importedSourcePathsBySourcePath: Map<string, string[]>;
}): Map<string, string[]> {
  const sourcesByStylesheetPath = new Map<string, Set<string>>();
  for (const [stylesheetPath, sourceFilePaths] of input.directlyImportedByStylesheetPath) {
    sourcesByStylesheetPath.set(stylesheetPath, new Set(sourceFilePaths));
  }
  for (const [stylesheetPath, sourceFilePaths] of input.packageImportedByStylesheetPath) {
    const existing = sourcesByStylesheetPath.get(stylesheetPath) ?? new Set<string>();
    for (const sourceFilePath of sourceFilePaths) {
      existing.add(sourceFilePath);
    }
    sourcesByStylesheetPath.set(stylesheetPath, existing);
  }

  const importedByImporterPath = new Map<string, string[]>();
  for (const [stylesheetPath, importerPaths] of input.stylesheetImportersByStylesheetPath) {
    for (const importerPath of importerPaths) {
      pushMapValue(importedByImporterPath, importerPath, stylesheetPath);
    }
  }
  const queue = [...sourcesByStylesheetPath.keys()];
  const queued = new Set(queue);
  while (queue.length > 0) {
    const importerPath = queue.shift();
    if (!importerPath) {
      continue;
    }
    queued.delete(importerPath);
    const importerSources = sourcesByStylesheetPath.get(importerPath);
    if (!importerSources || importerSources.size === 0) {
      continue;
    }
    for (const importedPath of importedByImporterPath.get(importerPath) ?? []) {
      const targetSources = sourcesByStylesheetPath.get(importedPath) ?? new Set<string>();
      const beforeSize = targetSources.size;
      for (const sourceFilePath of importerSources) {
        targetSources.add(sourceFilePath);
      }
      if (targetSources.size !== beforeSize) {
        sourcesByStylesheetPath.set(importedPath, targetSources);
        if (!queued.has(importedPath)) {
          queue.push(importedPath);
          queued.add(importedPath);
        }
      }
    }
  }

  return new Map(
    [...sourcesByStylesheetPath.entries()].map(([stylesheetPath, sourceFilePaths]) => [
      stylesheetPath,
      expandSourceContextsThroughImports({
        sourceFilePaths: [...sourceFilePaths],
        importedSourcePathsBySourcePath: input.importedSourcePathsBySourcePath,
      }),
    ]),
  );
}

function expandSourceContextsThroughImports(input: {
  sourceFilePaths: string[];
  importedSourcePathsBySourcePath: Map<string, string[]>;
}): string[] {
  const expanded = new Set<string>(input.sourceFilePaths);
  const importerSourcePathsByImportedSourcePath = new Map<string, string[]>();
  for (const [importerPath, importedPaths] of input.importedSourcePathsBySourcePath.entries()) {
    for (const importedPath of importedPaths) {
      pushMapValue(importerSourcePathsByImportedSourcePath, importedPath, importerPath);
    }
  }

  expandSourceContexts({
    expanded,
    sourceFilePaths: input.sourceFilePaths,
    connectedSourcePathsBySourcePath: input.importedSourcePathsBySourcePath,
  });
  expandSourceContexts({
    expanded,
    sourceFilePaths: input.sourceFilePaths,
    connectedSourcePathsBySourcePath: importerSourcePathsByImportedSourcePath,
  });

  return [...expanded].sort((left, right) => left.localeCompare(right));
}

function expandSourceContexts(input: {
  expanded: Set<string>;
  sourceFilePaths: string[];
  connectedSourcePathsBySourcePath: Map<string, string[]>;
}): void {
  const queue = [...input.sourceFilePaths];
  const queued = new Set(queue);

  while (queue.length > 0) {
    const sourceFilePath = queue.shift();
    if (!sourceFilePath) {
      continue;
    }
    queued.delete(sourceFilePath);
    const connectedSourcePaths = (input.connectedSourcePathsBySourcePath.get(sourceFilePath) ?? [])
      .slice()
      .sort((left, right) => left.localeCompare(right));
    for (const connectedSourcePath of connectedSourcePaths) {
      if (input.expanded.has(connectedSourcePath)) {
        continue;
      }
      input.expanded.add(connectedSourcePath);
      if (!queued.has(connectedSourcePath)) {
        queue.push(connectedSourcePath);
        queued.add(connectedSourcePath);
      }
    }
  }
}

function buildEntryBundleContextsByStylesheetPath(input: {
  snapshotEdges: ProjectResourceEdge[];
  moduleFilePaths: string[];
  importedSourcePathsBySourcePath: Map<string, string[]>;
  directlyImportedByStylesheetPath: Map<string, string[]>;
  packageImportedByStylesheetPath: Map<string, string[]>;
  stylesheetImportersByStylesheetPath: Map<string, string[]>;
}): Map<string, StylesheetReachabilityContextRecord[]> {
  const sourceImportedStylesheetsBySourcePath = new Map<string, string[]>();
  for (const [stylesheetPath, sourceFilePaths] of input.directlyImportedByStylesheetPath) {
    for (const sourceFilePath of sourceFilePaths) {
      pushMapValue(sourceImportedStylesheetsBySourcePath, sourceFilePath, stylesheetPath);
    }
  }
  for (const [stylesheetPath, sourceFilePaths] of input.packageImportedByStylesheetPath) {
    for (const sourceFilePath of sourceFilePaths) {
      pushMapValue(sourceImportedStylesheetsBySourcePath, sourceFilePath, stylesheetPath);
    }
  }

  const importedStylesheetPathsByStylesheetPath = new Map<string, string[]>();
  for (const [
    importedStylesheetPath,
    importerStylesheetPaths,
  ] of input.stylesheetImportersByStylesheetPath) {
    for (const importerStylesheetPath of importerStylesheetPaths) {
      pushMapValue(
        importedStylesheetPathsByStylesheetPath,
        importerStylesheetPath,
        importedStylesheetPath,
      );
    }
  }

  const contextsByStylesheetPath = new Map<string, StylesheetReachabilityContextRecord[]>();
  const contextKeysByStylesheetPath = new Map<string, Set<string>>();
  const htmlEntryEdges = input.snapshotEdges
    .filter(
      (
        edge,
      ): edge is ProjectResourceEdge & {
        kind: "html-script";
        resolvedFilePath: string;
      } => edge.kind === "html-script" && Boolean(edge.resolvedFilePath),
    )
    .map((edge) => ({
      htmlFilePath: normalizeProjectPath(edge.fromHtmlFilePath),
      entrySourceFilePath: normalizeProjectPath(edge.resolvedFilePath),
    }))
    .sort(
      (left, right) =>
        left.htmlFilePath.localeCompare(right.htmlFilePath) ||
        left.entrySourceFilePath.localeCompare(right.entrySourceFilePath),
    );
  const moduleFilePathSet = new Set(input.moduleFilePaths);
  const validHtmlEntryEdges = htmlEntryEdges.filter((entry) =>
    moduleFilePathSet.has(entry.entrySourceFilePath),
  );
  const appEntries: Array<{ entrySourceFilePath: string; htmlFilePath?: string }> =
    validHtmlEntryEdges.length > 0
      ? validHtmlEntryEdges
      : collectConventionalEntrySourceFilePaths(input.moduleFilePaths).map(
          (entrySourceFilePath) => ({
            entrySourceFilePath,
          }),
        );

  for (const entry of appEntries) {
    const bundleSourceFilePaths = collectReachableSourceFilePaths({
      entrySourceFilePath: entry.entrySourceFilePath,
      importedSourcePathsBySourcePath: input.importedSourcePathsBySourcePath,
      moduleFilePaths: input.moduleFilePaths,
    });
    const bundleStylesheetPaths = collectBundleStylesheetPaths({
      sourceFilePaths: bundleSourceFilePaths,
      sourceImportedStylesheetsBySourcePath,
      importedStylesheetPathsByStylesheetPath,
    });

    for (const stylesheetPath of bundleStylesheetPaths) {
      for (const sourceFilePath of bundleSourceFilePaths) {
        pushUniqueContext(contextsByStylesheetPath, contextKeysByStylesheetPath, stylesheetPath, {
          context: { kind: "source-file", filePath: sourceFilePath },
          availability: "definite",
          reasons: ["stylesheet is loaded by the same HTML app entry bundle"],
          derivations: [
            {
              kind: "source-file-entry-bundle",
              entrySourceFilePath: entry.entrySourceFilePath,
              ...(entry.htmlFilePath ? { htmlFilePath: entry.htmlFilePath } : {}),
            },
          ],
          traces: [],
        });
      }
    }
  }

  return contextsByStylesheetPath;
}

function collectConventionalEntrySourceFilePaths(moduleFilePaths: string[]): string[] {
  const entryFileNames = new Set(["main.jsx", "main.js", "main.ts", "main.tsx"]);
  return moduleFilePaths
    .filter((filePath) => entryFileNames.has(getBaseName(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
}

function getBaseName(filePath: string): string {
  return normalizeProjectPath(filePath).split("/").at(-1) ?? filePath;
}

function collectReachableSourceFilePaths(input: {
  entrySourceFilePath: string;
  importedSourcePathsBySourcePath: Map<string, string[]>;
  moduleFilePaths: string[];
}): string[] {
  const moduleFilePaths = new Set(input.moduleFilePaths);
  const reachable = new Set<string>();
  const queue = [input.entrySourceFilePath];
  const queued = new Set(queue);

  while (queue.length > 0) {
    const sourceFilePath = queue.shift();
    if (!sourceFilePath) {
      continue;
    }
    queued.delete(sourceFilePath);
    if (!moduleFilePaths.has(sourceFilePath) || reachable.has(sourceFilePath)) {
      continue;
    }
    reachable.add(sourceFilePath);

    const importedSourcePaths = (input.importedSourcePathsBySourcePath.get(sourceFilePath) ?? [])
      .slice()
      .sort((left, right) => left.localeCompare(right));
    for (const importedSourcePath of importedSourcePaths) {
      if (reachable.has(importedSourcePath) || queued.has(importedSourcePath)) {
        continue;
      }
      queue.push(importedSourcePath);
      queued.add(importedSourcePath);
    }
  }

  return [...reachable].sort((left, right) => left.localeCompare(right));
}

function collectBundleStylesheetPaths(input: {
  sourceFilePaths: string[];
  sourceImportedStylesheetsBySourcePath: Map<string, string[]>;
  importedStylesheetPathsByStylesheetPath: Map<string, string[]>;
}): string[] {
  const stylesheetPaths = new Set<string>();
  const queue: string[] = [];
  const queued = new Set<string>();

  for (const sourceFilePath of input.sourceFilePaths) {
    for (const stylesheetPath of input.sourceImportedStylesheetsBySourcePath.get(sourceFilePath) ??
      []) {
      if (stylesheetPaths.has(stylesheetPath) || queued.has(stylesheetPath)) {
        continue;
      }
      queue.push(stylesheetPath);
      queued.add(stylesheetPath);
    }
  }

  while (queue.length > 0) {
    const stylesheetPath = queue.shift();
    if (!stylesheetPath) {
      continue;
    }
    queued.delete(stylesheetPath);
    if (stylesheetPaths.has(stylesheetPath)) {
      continue;
    }
    stylesheetPaths.add(stylesheetPath);

    const importedStylesheetPaths = (
      input.importedStylesheetPathsByStylesheetPath.get(stylesheetPath) ?? []
    )
      .slice()
      .sort((left, right) => left.localeCompare(right));
    for (const importedStylesheetPath of importedStylesheetPaths) {
      if (stylesheetPaths.has(importedStylesheetPath) || queued.has(importedStylesheetPath)) {
        continue;
      }
      queue.push(importedStylesheetPath);
      queued.add(importedStylesheetPath);
    }
  }

  return [...stylesheetPaths].sort((left, right) => left.localeCompare(right));
}

function collectSelectorDerivedStylesheetContexts(input: ProjectEvidenceBuildInput): Map<
  string,
  {
    cssFilePath: string;
    availability: ReachabilityAvailability;
    contexts: StylesheetReachabilityContextRecord[];
    reasons: string[];
    traces: AnalysisTrace[];
  }
> {
  const selectorReachability = input.selectorReachability;
  if (!selectorReachability) {
    return new Map();
  }

  const stylesheetPathByNodeId = new Map(
    input.factGraph.graph.nodes.stylesheets
      .filter((stylesheet) => stylesheet.filePath)
      .map((stylesheet) => [stylesheet.id, normalizeProjectPath(stylesheet.filePath as string)]),
  );
  const contextsByStylesheetPath = new Map<string, StylesheetReachabilityContextRecord[]>();
  const contextKeysByStylesheetPath = new Map<string, Set<string>>();
  const hasSelectorBranchesByStylesheetPath = new Set<string>();
  const componentByNodeId = new Map<
    string,
    {
      filePath: string;
      componentKey: string;
      componentName: string;
    }
  >();
  for (const component of input.renderModel.components) {
    if (!component.componentNodeId) {
      continue;
    }
    componentByNodeId.set(component.componentNodeId, {
      filePath: component.filePath,
      componentKey: component.componentKey,
      componentName: component.componentName,
    });
  }

  for (const branch of selectorReachability.selectorBranches) {
    if (!branch.stylesheetNodeId) {
      continue;
    }

    const stylesheetPath = stylesheetPathByNodeId.get(branch.stylesheetNodeId);
    if (!stylesheetPath) {
      continue;
    }

    hasSelectorBranchesByStylesheetPath.add(stylesheetPath);
    const matchIds =
      selectorReachability.indexes.matchIdsBySelectorBranchNodeId.get(
        branch.selectorBranchNodeId,
      ) ?? [];
    for (const matchId of matchIds) {
      const match = selectorReachability.indexes.matchById.get(matchId);
      if (!match) {
        continue;
      }

      const context = projectContextFromSelectorMatch({
        match,
        input,
        componentByNodeId,
      });
      if (!context) {
        continue;
      }

      pushUniqueContext(
        contextsByStylesheetPath,
        contextKeysByStylesheetPath,
        stylesheetPath,
        context,
      );
    }
  }

  const selectorDerived = new Map<
    string,
    {
      cssFilePath: string;
      availability: ReachabilityAvailability;
      contexts: StylesheetReachabilityContextRecord[];
      reasons: string[];
      traces: AnalysisTrace[];
    }
  >();
  for (const stylesheetPath of hasSelectorBranchesByStylesheetPath) {
    const contexts = contextsByStylesheetPath.get(stylesheetPath) ?? [];
    const availability: ReachabilityAvailability = contexts.some(
      (context) => context.availability === "definite",
    )
      ? "definite"
      : contexts.some((context) => context.availability === "possible")
        ? "possible"
        : contexts.some((context) => context.availability === "unknown")
          ? "unknown"
          : "unavailable";

    selectorDerived.set(stylesheetPath, {
      cssFilePath: stylesheetPath,
      availability,
      contexts: [...contexts],
      reasons:
        contexts.length > 0
          ? ["stylesheet matched bounded selector reachability contexts"]
          : ["stylesheet selectors had no bounded matches in render-aware analysis"],
      traces: [],
    });
  }

  return selectorDerived;
}

function projectContextFromSelectorMatch(input: {
  match: SelectorBranchMatch;
  input: ProjectEvidenceBuildInput;
  componentByNodeId: Map<
    string,
    {
      filePath: string;
      componentKey: string;
      componentName: string;
    }
  >;
}): StylesheetReachabilityContextRecord | undefined {
  const element = input.input.selectorReachability?.indexes.renderElementById.get(
    input.match.subjectElementId,
  );
  if (!element) {
    return undefined;
  }

  const availability: ReachabilityAvailability =
    input.match.certainty === "definite"
      ? "definite"
      : input.match.certainty === "possible"
        ? "possible"
        : input.match.certainty === "unknown-context"
          ? "unknown"
          : "unavailable";
  if (availability === "unavailable") {
    return undefined;
  }

  const componentNodeId = element.placementComponentNodeId ?? element.emittingComponentNodeId;
  const component = componentNodeId ? input.componentByNodeId.get(componentNodeId) : undefined;

  if (component) {
    return {
      context: {
        kind: "component",
        filePath: normalizeProjectPath(component.filePath),
        componentKey: component.componentKey,
        componentName: component.componentName,
      },
      availability,
      reasons: ["stylesheet selector matched render-aware component context"],
      derivations: [{ kind: "whole-component-direct-import" }],
      traces: [],
    };
  }

  return {
    context: {
      kind: "source-file",
      filePath: normalizeProjectPath(element.sourceLocation.filePath),
    },
    availability,
    reasons: ["stylesheet selector matched render-aware source-file context"],
    derivations: [{ kind: "source-file-direct-import" }],
    traces: [],
  };
}

function pushUniqueContext(
  map: Map<string, StylesheetReachabilityContextRecord[]>,
  keysByStylesheetPath: Map<string, Set<string>>,
  stylesheetPath: string,
  context: StylesheetReachabilityContextRecord,
): void {
  const existing = map.get(stylesheetPath) ?? [];
  const existingKeys = keysByStylesheetPath.get(stylesheetPath) ?? new Set<string>();
  const key = [
    `kind:${context.context.kind}`,
    `f:${context.context.filePath}`,
    `n:${"componentName" in context.context ? (context.context.componentName ?? "") : ""}`,
    `k:${"componentKey" in context.context ? (context.context.componentKey ?? "") : ""}`,
    `a:${context.availability}`,
  ].join("|");
  if (!existingKeys.has(key)) {
    existingKeys.add(key);
    existing.push(context);
  }
  map.set(stylesheetPath, existing);
  keysByStylesheetPath.set(stylesheetPath, existingKeys);
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

export function getBestReachabilityForReference(input: {
  reference: ClassReferenceAnalysis;
  stylesheetId: ProjectEvidenceId;
  reachabilityByStylesheetAndSource: Map<string, StylesheetReachabilityRelation[]>;
  reachabilityByStylesheet: Map<ProjectEvidenceId, StylesheetReachabilityRelation[]>;
}): {
  availability: ReachabilityAvailability;
  traces: AnalysisTrace[];
} {
  const candidateRelations = [
    ...getReachabilityRelations({
      stylesheetId: input.stylesheetId,
      kind: "source",
      id: input.reference.sourceFileId,
      reachabilityByStylesheetAndSource: input.reachabilityByStylesheetAndSource,
    }),
    ...(input.reference.componentId
      ? getReachabilityRelations({
          stylesheetId: input.stylesheetId,
          kind: "component",
          id: input.reference.componentId,
          reachabilityByStylesheetAndSource: input.reachabilityByStylesheetAndSource,
        })
      : []),
  ];
  const stylesheetRelations = input.reachabilityByStylesheet.get(input.stylesheetId) ?? [];

  const definiteRelations = candidateRelations.filter(
    (relation) => relation.availability === "definite",
  );
  if (definiteRelations.length > 0) {
    return {
      availability: "definite",
      traces: mergeTraces(definiteRelations.flatMap((relation) => relation.traces)),
    };
  }

  const possibleRelations = candidateRelations.filter(
    (relation) => relation.availability === "possible",
  );
  if (possibleRelations.length > 0) {
    return {
      availability: "possible",
      traces: mergeTraces(possibleRelations.flatMap((relation) => relation.traces)),
    };
  }

  const unavailableRelations =
    candidateRelations.length > 0
      ? candidateRelations.filter((relation) => relation.availability === "unavailable")
      : stylesheetRelations.filter((relation) => relation.availability === "unavailable");
  if (unavailableRelations.length > 0) {
    return {
      availability: "unavailable",
      traces: mergeTraces(unavailableRelations.flatMap((relation) => relation.traces)),
    };
  }
  return {
    availability: "unknown",
    traces: mergeTraces(candidateRelations.flatMap((relation) => relation.traces)),
  };
}

export function getReachabilityRelations(input: {
  stylesheetId: ProjectEvidenceId;
  kind: "source" | "component";
  id: ProjectEvidenceId;
  reachabilityByStylesheetAndSource: Map<string, StylesheetReachabilityRelation[]>;
}): StylesheetReachabilityRelation[] {
  return (
    input.reachabilityByStylesheetAndSource.get(
      createReachabilityContextKey(input.stylesheetId, input.kind, input.id),
    ) ?? []
  );
}

export function getSourceFileIdForContext(
  contextRecord: StylesheetReachabilityRelation["contexts"][number],
  indexes: ProjectEvidenceBuilderIndexes,
): ProjectEvidenceId | undefined {
  const context = contextRecord.context;
  if (
    context.kind === "source-file" ||
    context.kind === "component" ||
    context.kind === "render-subtree-root" ||
    context.kind === "render-region"
  ) {
    return indexes.sourceFileIdByPath.get(normalizeProjectPath(context.filePath));
  }

  return undefined;
}

export function getComponentIdForContext(
  contextRecord: StylesheetReachabilityRelation["contexts"][number],
  indexes: ProjectEvidenceBuilderIndexes,
): ProjectEvidenceId | undefined {
  const context = contextRecord.context;
  if (
    (context.kind === "component" ||
      context.kind === "render-subtree-root" ||
      context.kind === "render-region") &&
    (context.componentKey || context.componentName)
  ) {
    if (context.componentKey) {
      return indexes.componentIdByComponentKey.get(context.componentKey);
    }

    if (context.componentName) {
      return indexes.componentIdByFilePathAndName.get(
        createComponentKey(normalizeProjectPath(context.filePath), context.componentName),
      );
    }
  }

  return undefined;
}
