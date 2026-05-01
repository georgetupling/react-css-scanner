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
    directlyImportedByStylesheetPath.set(stylesheetPath, [
      ...(directlyImportedByStylesheetPath.get(stylesheetPath) ?? []),
      normalizeProjectPath(edge.importerFilePath),
    ]);
  }

  const stylesheetImportersByStylesheetPath = new Map<string, string[]>();
  for (const edge of input.factGraph?.snapshot.edges ?? []) {
    if (edge.kind === "stylesheet-import" && edge.resolvedFilePath) {
      const importedPath = normalizeProjectPath(edge.resolvedFilePath);
      const importerPath = normalizeProjectPath(edge.importerFilePath);
      stylesheetImportersByStylesheetPath.set(importedPath, [
        ...(stylesheetImportersByStylesheetPath.get(importedPath) ?? []),
        importerPath,
      ]);
      continue;
    }
    if (
      edge.kind === "package-css-import" &&
      edge.importerKind === "stylesheet" &&
      edge.resolvedFilePath
    ) {
      const importedPath = normalizeProjectPath(edge.resolvedFilePath);
      const importerPath = normalizeProjectPath(edge.importerFilePath);
      stylesheetImportersByStylesheetPath.set(importedPath, [
        ...(stylesheetImportersByStylesheetPath.get(importedPath) ?? []),
        importerPath,
      ]);
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
    packageImportedByStylesheetPath.set(stylesheetPath, [
      ...(packageImportedByStylesheetPath.get(stylesheetPath) ?? []),
      sourceFilePath,
    ]);
  }
  const importedSourcePathsBySourcePath = new Map<string, string[]>();
  for (const edge of graph.edges.imports) {
    if (edge.importerKind !== "source" || edge.importKind !== "source" || !edge.resolvedFilePath) {
      continue;
    }
    const importerPath = normalizeProjectPath(edge.importerFilePath);
    const importedPath = normalizeProjectPath(edge.resolvedFilePath);
    importedSourcePathsBySourcePath.set(importerPath, [
      ...(importedSourcePathsBySourcePath.get(importerPath) ?? []),
      importedPath,
    ]);
  }
  const sourceContextsByStylesheetPath = buildTransitiveSourceContextsByStylesheetPath({
    directlyImportedByStylesheetPath,
    stylesheetImportersByStylesheetPath,
    packageImportedByStylesheetPath,
    importedSourcePathsBySourcePath,
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

  let changed = true;
  while (changed) {
    changed = false;
    for (const [stylesheetPath, importerPaths] of input.stylesheetImportersByStylesheetPath) {
      const existing = sourcesByStylesheetPath.get(stylesheetPath) ?? new Set<string>();
      const beforeSize = existing.size;
      for (const importerPath of importerPaths) {
        for (const sourceFilePath of sourcesByStylesheetPath.get(importerPath) ?? []) {
          existing.add(sourceFilePath);
        }
      }
      if (existing.size !== beforeSize) {
        sourcesByStylesheetPath.set(stylesheetPath, existing);
        changed = true;
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
  const queue = [...input.sourceFilePaths];

  while (queue.length > 0) {
    const sourceFilePath = queue.shift();
    if (!sourceFilePath) {
      continue;
    }
    for (const importedSourcePath of input.importedSourcePathsBySourcePath.get(sourceFilePath) ??
      []) {
      if (expanded.has(importedSourcePath)) {
        continue;
      }
      expanded.add(importedSourcePath);
      queue.push(importedSourcePath);
    }
  }

  return [...expanded].sort((left, right) => left.localeCompare(right));
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
  const hasSelectorBranchesByStylesheetPath = new Set<string>();

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
      });
      if (!context) {
        continue;
      }

      pushUniqueContext(contextsByStylesheetPath, stylesheetPath, context);
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
  const component = componentNodeId
    ? input.input.renderModel.components.find(
        (candidate) => candidate.componentNodeId === componentNodeId,
      )
    : undefined;

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
  stylesheetPath: string,
  context: StylesheetReachabilityContextRecord,
): void {
  const existing = map.get(stylesheetPath) ?? [];
  const key = JSON.stringify({
    kind: context.context.kind,
    filePath: context.context.filePath,
    componentName: "componentName" in context.context ? context.context.componentName : undefined,
    componentKey: "componentKey" in context.context ? context.context.componentKey : undefined,
    availability: context.availability,
  });
  if (
    !existing.some(
      (candidate) =>
        JSON.stringify({
          kind: candidate.context.kind,
          filePath: candidate.context.filePath,
          componentName:
            "componentName" in candidate.context ? candidate.context.componentName : undefined,
          componentKey:
            "componentKey" in candidate.context ? candidate.context.componentKey : undefined,
          availability: candidate.availability,
        }) === key,
    )
  ) {
    existing.push(context);
  }
  map.set(stylesheetPath, existing);
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
