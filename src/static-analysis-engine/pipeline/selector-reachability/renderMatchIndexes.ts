import type { FactGraph, SelectorBranchNode, StyleSheetNode } from "../fact-graph/index.js";
import type { EmissionSite, RenderModel, RenderedElement } from "../render-structure/index.js";
import type { SourceAnchor } from "../../types/core.js";
import { resolveCssModuleExpressionReferences } from "../project-evidence/entities/cssModuleExpressionReferences.js";
import { getCssModuleExportNames } from "../project-evidence/entities/cssModuleMemberMatches.js";

export type SelectorRenderMatchIndexes = {
  renderModel: RenderModel;
  elementsById: Map<string, RenderedElement>;
  emissionSitesById: Map<string, EmissionSite>;
  emissionSiteIdsByElementId: Map<string, string[]>;
  elementIdsByClassName: Map<string, string[]>;
  cssModuleElementIdsByScopeAndClassName: Map<string, string[]>;
  cssModuleClassNamesByEmissionSiteAndScope: Map<string, string[]>;
  cssModuleLocalClassNamesByScopeAndExportName: Map<string, string[]>;
  unknownClassElementIds: string[];
};

export function buildSelectorRenderMatchIndexes(
  renderModel: RenderModel,
  options: {
    selectorBranches?: SelectorBranchNode[];
    stylesheets?: StyleSheetNode[];
    factGraph?: FactGraph;
    cssModuleLocalsConvention?: "asIs" | "camelCase" | "camelCaseOnly";
  } = {},
): SelectorRenderMatchIndexes {
  const elementIdsByClassName = new Map<string, string[]>();
  const cssModuleLocalClassNamesByScopeAndExportName =
    buildCssModuleLocalClassNamesByScopeAndExportName(options);
  const cssModuleReferences = buildCssModuleReferenceMatches(options);
  const cssModuleElementIdsByScopeAndClassName = new Map<string, string[]>();
  const cssModuleClassNamesByEmissionSiteAndScope = new Map<string, string[]>();
  const unknownClassElementIds = new Set<string>();

  for (const emissionSite of renderModel.emissionSites) {
    if (!emissionSite.elementId) {
      if (emissionSite.confidence === "low" || emissionSite.unsupported.length > 0) {
        for (const elementId of getBoundaryUnknownClassElementIds(renderModel, emissionSite)) {
          unknownClassElementIds.add(elementId);
        }
      }
      continue;
    }

    if (emissionSite.confidence === "low" || emissionSite.unsupported.length > 0) {
      unknownClassElementIds.add(emissionSite.elementId);
    }

    for (const token of emissionSite.tokens) {
      if (token.tokenKind === "css-module-export") {
        continue;
      }

      pushMapValue(elementIdsByClassName, token.token, emissionSite.elementId);
    }

    for (const match of getCssModuleLocalClassMatches({
      emissionSite,
      cssModuleLocalClassNamesByScopeAndExportName,
      cssModuleReferences,
    })) {
      pushMapValue(
        cssModuleElementIdsByScopeAndClassName,
        createScopeClassKey(match.scopeId, match.className),
        emissionSite.elementId,
      );
      pushMapValue(
        cssModuleClassNamesByEmissionSiteAndScope,
        createScopeClassKey(emissionSite.id, match.scopeId),
        match.className,
      );
    }
  }

  sortMapValues(elementIdsByClassName);
  sortMapValues(cssModuleElementIdsByScopeAndClassName);
  sortMapValues(cssModuleClassNamesByEmissionSiteAndScope);

  return {
    renderModel,
    elementsById: renderModel.indexes.elementById,
    emissionSitesById: renderModel.indexes.emissionSiteById,
    emissionSiteIdsByElementId: renderModel.indexes.emissionSiteIdsByElementId,
    elementIdsByClassName,
    cssModuleElementIdsByScopeAndClassName,
    cssModuleClassNamesByEmissionSiteAndScope,
    cssModuleLocalClassNamesByScopeAndExportName,
    unknownClassElementIds: [...unknownClassElementIds].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function getBoundaryUnknownClassElementIds(
  renderModel: RenderModel,
  emissionSite: EmissionSite,
): string[] {
  const elementIds = new Set<string>();
  const boundary = renderModel.indexes.componentBoundaryById.get(emissionSite.boundaryId);
  for (const elementId of boundary?.rootElementIds ?? []) {
    elementIds.add(elementId);
  }

  if (!boundary?.componentNodeId) {
    return [...elementIds].sort((left, right) => left.localeCompare(right));
  }

  for (const expandedBoundary of renderModel.componentBoundaries) {
    if (
      expandedBoundary.id === boundary.id ||
      expandedBoundary.componentNodeId !== boundary.componentNodeId ||
      !expandedBoundary.parentBoundaryId
    ) {
      continue;
    }

    const parentBoundary = renderModel.indexes.componentBoundaryById.get(
      expandedBoundary.parentBoundaryId,
    );
    for (const elementId of parentBoundary?.rootElementIds ?? []) {
      elementIds.add(elementId);
    }
  }

  return [...elementIds].sort((left, right) => left.localeCompare(right));
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sortMapValues(map: Map<string, string[]>): void {
  for (const [key, values] of map.entries()) {
    map.set(
      key,
      [...new Set(values)].sort((left, right) => left.localeCompare(right)),
    );
  }
}

function buildCssModuleLocalClassNamesByScopeAndExportName(input: {
  selectorBranches?: SelectorBranchNode[];
  stylesheets?: StyleSheetNode[];
  cssModuleLocalsConvention?: "asIs" | "camelCase" | "camelCaseOnly";
}): Map<string, string[]> {
  const cssModuleStylesheetNodeIds = new Set(
    (input.stylesheets ?? [])
      .filter((stylesheet) => stylesheet.cssKind === "css-module")
      .map((stylesheet) => stylesheet.id),
  );
  const result = new Map<string, string[]>();

  for (const branch of input.selectorBranches ?? []) {
    if (!branch.stylesheetNodeId || !cssModuleStylesheetNodeIds.has(branch.stylesheetNodeId)) {
      continue;
    }

    const classNames = [
      ...branch.requiredClassNames,
      ...branch.subjectClassNames,
      ...branch.contextClassNames,
      ...branch.negativeClassNames,
      ...branch.hasDescendantClassNames,
    ];
    for (const className of classNames) {
      for (const exportName of getCssModuleExportNames(
        className,
        input.cssModuleLocalsConvention,
      )) {
        pushMapValue(result, createScopeClassKey(branch.stylesheetNodeId, exportName), className);
      }
    }
  }

  sortMapValues(result);
  return result;
}

function getCssModuleLocalClassMatches(input: {
  emissionSite: EmissionSite;
  cssModuleLocalClassNamesByScopeAndExportName: Map<string, string[]>;
  cssModuleReferences: CssModuleReferenceMatch[];
}): Array<{ scopeId: string; className: string }> {
  const matches: Array<{ scopeId: string; className: string }> = [];
  for (const contribution of input.emissionSite.cssModuleContributions) {
    if (!contribution.stylesheetNodeId) {
      continue;
    }
    const classNames =
      input.cssModuleLocalClassNamesByScopeAndExportName.get(
        createScopeClassKey(contribution.stylesheetNodeId, contribution.exportName),
      ) ?? [];
    for (const className of classNames) {
      matches.push({
        scopeId: contribution.stylesheetNodeId,
        className,
      });
    }
  }

  for (const reference of input.cssModuleReferences) {
    if (
      !input.emissionSite.elementId ||
      !anchorsOverlap(reference.location, input.emissionSite.sourceLocation)
    ) {
      continue;
    }
    const classNames =
      input.cssModuleLocalClassNamesByScopeAndExportName.get(
        createScopeClassKey(reference.scopeId, reference.exportName),
      ) ?? [];
    for (const className of classNames) {
      matches.push({
        scopeId: reference.scopeId,
        className,
      });
    }
  }
  return matches;
}

export function createScopeClassKey(scopeId: string, className: string): string {
  return `${scopeId}\0${className}`;
}

type CssModuleReferenceMatch = {
  scopeId: string;
  exportName: string;
  location: SourceAnchor;
};

function buildCssModuleReferenceMatches(input: {
  factGraph?: FactGraph;
}): CssModuleReferenceMatch[] {
  const graph = input.factGraph;
  if (!graph) {
    return [];
  }

  const importScopeBySourceLocalName = new Map<string, string[]>();
  for (const edge of graph.edges.imports) {
    if (edge.importKind !== "css" || edge.cssSemantics !== "module" || !edge.resolvedTargetNodeId) {
      continue;
    }
    for (const importName of edge.importNames ?? []) {
      if (importName.bindingKind !== "default" && importName.bindingKind !== "namespace") {
        continue;
      }
      pushMapValue(
        importScopeBySourceLocalName,
        `${normalizeProjectPath(edge.importerFilePath)}:${importName.localName}`,
        edge.resolvedTargetNodeId,
      );
    }
  }
  sortMapValues(importScopeBySourceLocalName);

  const matches: CssModuleReferenceMatch[] = [];
  for (const classSite of graph.nodes.classExpressionSites) {
    const expressionNode = graph.indexes.nodesById.get(classSite.expressionNodeId);
    if (!expressionNode || expressionNode.kind !== "expression-syntax") {
      continue;
    }
    for (const reference of resolveCssModuleExpressionReferences({
      expressionNode,
      factGraph: graph,
    })) {
      const scopeIds =
        importScopeBySourceLocalName.get(
          `${normalizeProjectPath(classSite.filePath)}:${reference.localName}`,
        ) ?? [];
      for (const scopeId of scopeIds) {
        matches.push({
          scopeId,
          exportName: reference.memberName,
          location: classSite.location,
        });
      }
    }
  }

  return matches.sort(
    (left, right) =>
      left.scopeId.localeCompare(right.scopeId) ||
      left.exportName.localeCompare(right.exportName) ||
      compareAnchors(left.location, right.location),
  );
}

function anchorsOverlap(left: SourceAnchor, right: SourceAnchor): boolean {
  if (normalizeProjectPath(left.filePath) !== normalizeProjectPath(right.filePath)) {
    return false;
  }

  const leftStart = toAnchorPositionValue(left.startLine, left.startColumn);
  const leftEnd = toAnchorPositionValue(
    left.endLine ?? left.startLine,
    left.endColumn ?? left.startColumn,
  );
  const rightStart = toAnchorPositionValue(right.startLine, right.startColumn);
  const rightEnd = toAnchorPositionValue(
    right.endLine ?? right.startLine,
    right.endColumn ?? right.startColumn,
  );

  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function compareAnchors(left: SourceAnchor, right: SourceAnchor): number {
  return (
    normalizeProjectPath(left.filePath).localeCompare(normalizeProjectPath(right.filePath)) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    (left.endLine ?? left.startLine) - (right.endLine ?? right.startLine) ||
    (left.endColumn ?? left.startColumn) - (right.endColumn ?? right.startColumn)
  );
}

function toAnchorPositionValue(line: number, column: number): number {
  return line * 1_000_000 + column;
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}
