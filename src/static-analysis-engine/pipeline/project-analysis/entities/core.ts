import { getAllResolvedModuleFacts } from "../../module-facts/index.js";
import type { StyleSheetNode } from "../../fact-graph/index.js";
import type {
  RenderGraphProjectionNode,
  RenderModel,
  UnsupportedClassReferenceDiagnostic,
} from "../../render-structure/index.js";
import type {
  ClassContextAnalysis,
  ClassDefinitionAnalysis,
  ComponentAnalysis,
  ProjectAnalysisBuildInput,
  ProjectAnalysisIndexes,
  ProjectAnalysisStylesheetInput,
  RenderSubtreeAnalysis,
  SourceFileAnalysis,
  StylesheetAnalysis,
  UnsupportedClassReferenceAnalysis,
} from "../types.js";
import {
  compareById,
  compareAnchors,
  createAnchorId,
  createClassContextId,
  createClassDefinitionId,
  createComponentId,
  createComponentKey,
  createPathId,
  getDeclarationSignature,
  getDefinitionSelectorKind,
  getSelectorBranchKind,
  getStylesheetOriginFromInventory,
  isCssModuleStylesheetFromInventory,
  normalizeAnchor,
  normalizeOptionalProjectPath,
  normalizeProjectPath,
  pushMapValue,
  sortIndexValues,
} from "../internal/shared.js";

export function buildSourceFiles(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
): SourceFileAnalysis[] {
  const sourceFiles: SourceFileAnalysis[] = [];
  const sourcePaths = new Set<string>();

  if (input.factGraph) {
    for (const moduleNode of input.factGraph.graph.nodes.modules) {
      sourcePaths.add(normalizeProjectPath(moduleNode.filePath));
    }
  } else {
    for (const moduleFacts of getAllResolvedModuleFacts({
      moduleFacts: input.moduleFacts,
    })) {
      sourcePaths.add(normalizeProjectPath(moduleFacts.filePath));
    }

    for (const component of input.renderModel.components) {
      sourcePaths.add(normalizeProjectPath(component.filePath));
    }
  }

  for (const filePath of [...sourcePaths].sort((left, right) => left.localeCompare(right))) {
    const id = createPathId("source", filePath);
    indexes.sourceFileIdByPath.set(filePath, id);
    sourceFiles.push({
      id,
      filePath,
      moduleKind: "source",
    });
  }

  return sourceFiles;
}

export function buildComponents(
  renderGraphNodes: RenderGraphProjectionNode[],
  indexes: ProjectAnalysisIndexes,
  input?: ProjectAnalysisBuildInput,
): ComponentAnalysis[] {
  const graphComponentNodes = input?.factGraph?.graph.nodes.components;
  const components = graphComponentNodes
    ? graphComponentNodes.map((node) => {
        const filePath = normalizeProjectPath(node.filePath);
        const id = createComponentId(filePath, node.componentName);
        indexes.componentIdByComponentKey.set(node.componentKey, id);
        indexes.componentIdByFilePathAndName.set(
          createComponentKey(filePath, node.componentName),
          id,
        );

        return {
          id,
          componentKey: node.componentKey,
          filePath,
          componentName: node.componentName,
          exported: node.exported,
          location: normalizeAnchor(node.location),
        };
      })
    : renderGraphNodes.map((node) => {
        const filePath = normalizeProjectPath(node.filePath);
        const id = createComponentId(filePath, node.componentName);
        indexes.componentIdByComponentKey.set(node.componentKey, id);
        indexes.componentIdByFilePathAndName.set(
          createComponentKey(filePath, node.componentName),
          id,
        );

        return {
          id,
          componentKey: node.componentKey,
          filePath,
          componentName: node.componentName,
          exported: node.exported,
          location: normalizeAnchor(node.sourceLocation),
        };
      });

  return components.sort(compareById);
}

export function buildRenderSubtrees(
  renderModel: RenderModel,
  indexes: ProjectAnalysisIndexes,
): RenderSubtreeAnalysis[] {
  return renderModel.componentBoundaries
    .filter((boundary) => boundary.boundaryKind === "component-root")
    .map((boundary, index) => {
      const location = normalizeAnchor(
        boundary.declarationLocation ??
          boundary.referenceLocation ?? {
            filePath: boundary.filePath ?? "<unknown>",
            startLine: 1,
            startColumn: 1,
          },
      );
      const filePath = normalizeProjectPath(boundary.filePath ?? location.filePath);
      const componentId = boundary.componentKey
        ? indexes.componentIdByComponentKey.get(boundary.componentKey)
        : boundary.componentName
          ? indexes.componentIdByFilePathAndName.get(
              createComponentKey(filePath, boundary.componentName),
            )
          : undefined;

      return {
        id: createAnchorId("render-subtree", location, index),
        componentId,
        componentKey: boundary.componentKey,
        filePath,
        componentName: boundary.componentName,
        exported: renderModel.components.some(
          (component) => component.componentKey === boundary.componentKey && component.exported,
        ),
        location,
        sourceBoundaryId: boundary.id,
      };
    })
    .sort(compareById);
}

export function buildStylesheets(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
): StylesheetAnalysis[] {
  const stylesheetInputsByPath = indexStylesheetInputsByPath(input);
  const stylesheets = input.cssFiles.map((cssFile, index) => {
    const filePath = normalizeOptionalProjectPath(cssFile.filePath);
    const stylesheetInput = filePath ? stylesheetInputsByPath.get(filePath) : undefined;
    const id = filePath ? createPathId("stylesheet", filePath) : `stylesheet:anonymous:${index}`;
    if (filePath) {
      indexes.stylesheetIdByPath.set(filePath, id);
    }

    return {
      id,
      filePath,
      origin: getStylesheetOriginFromInventory(stylesheetInput, filePath, input),
      definitions: [],
      selectors: [],
    };
  });

  return stylesheets.sort(compareById);
}

export function buildClassDefinitions(
  input: ProjectAnalysisBuildInput,
  stylesheets: StylesheetAnalysis[],
  indexes: ProjectAnalysisIndexes,
): ClassDefinitionAnalysis[] {
  const stylesheetInputsByPath = indexStylesheetInputsByPath(input);
  const stylesheetsByPath = new Map(
    stylesheets.map((stylesheet) => [stylesheet.filePath ?? stylesheet.id, stylesheet]),
  );
  const definitions: ClassDefinitionAnalysis[] = [];

  for (const cssFile of input.cssFiles) {
    const stylesheet =
      stylesheetsByPath.get(normalizeOptionalProjectPath(cssFile.filePath) ?? "") ??
      stylesheets.find((candidate) => candidate.filePath === undefined);
    if (!stylesheet) {
      continue;
    }

    for (const definition of cssFile.classDefinitions) {
      const stylesheetInput = stylesheet.filePath
        ? stylesheetInputsByPath.get(stylesheet.filePath)
        : undefined;
      const id = createClassDefinitionId(stylesheet.id, definition);
      const analysis: ClassDefinitionAnalysis = {
        id,
        stylesheetId: stylesheet.id,
        className: definition.className,
        selectorText: definition.selector,
        selectorKind: getDefinitionSelectorKind(definition),
        line: definition.line,
        atRuleContext: [...definition.atRuleContext],
        declarationProperties: [...definition.declarations],
        declarationSignature: getDeclarationSignature(definition.declarationDetails),
        isCssModule: isCssModuleStylesheetFromInventory(stylesheetInput, stylesheet.filePath),
        sourceDefinition: definition,
      };

      definitions.push(analysis);
      stylesheet.definitions.push(id);
      pushMapValue(indexes.definitionsByClassName, definition.className, id);
      pushMapValue(indexes.definitionsByStylesheetId, stylesheet.id, id);
    }
  }

  sortIndexValues(indexes.definitionsByClassName);
  sortIndexValues(indexes.definitionsByStylesheetId);
  return definitions.sort(compareById);
}

function indexStylesheetInputsByPath(
  input: ProjectAnalysisBuildInput,
): Map<string, ProjectAnalysisStylesheetInput> {
  const stylesheetsByPath = new Map<string, ProjectAnalysisStylesheetInput>();
  for (const stylesheet of input.factGraph?.graph.nodes.stylesheets ?? []) {
    const filePath = normalizeOptionalProjectPath(stylesheet.filePath);
    if (!filePath) {
      continue;
    }

    stylesheetsByPath.set(filePath, graphStylesheetToProjectInput(stylesheet, filePath));
  }

  for (const stylesheet of input.stylesheets ?? []) {
    const filePath = normalizeOptionalProjectPath(stylesheet.filePath);
    if (!filePath) {
      continue;
    }

    stylesheetsByPath.set(filePath, {
      ...stylesheet,
      filePath,
    });
  }

  return stylesheetsByPath;
}

function graphStylesheetToProjectInput(
  stylesheet: StyleSheetNode,
  filePath: string,
): ProjectAnalysisStylesheetInput {
  return {
    filePath,
    cssKind: stylesheet.cssKind,
    origin: stylesheet.origin,
  };
}

export function buildClassContexts(
  input: ProjectAnalysisBuildInput,
  stylesheets: StylesheetAnalysis[],
  indexes: ProjectAnalysisIndexes,
): ClassContextAnalysis[] {
  const stylesheetsByPath = new Map(
    stylesheets.map((stylesheet) => [stylesheet.filePath ?? stylesheet.id, stylesheet]),
  );
  const contexts: ClassContextAnalysis[] = [];

  for (const cssFile of input.cssFiles) {
    const stylesheet =
      stylesheetsByPath.get(normalizeOptionalProjectPath(cssFile.filePath) ?? "") ??
      stylesheets.find((candidate) => candidate.filePath === undefined);
    if (!stylesheet) {
      continue;
    }

    for (const context of cssFile.classContexts) {
      const id = createClassContextId(stylesheet.id, context);
      const analysis: ClassContextAnalysis = {
        id,
        stylesheetId: stylesheet.id,
        className: context.className,
        selectorText: context.selector,
        selectorKind: getSelectorBranchKind(context.selectorBranch),
        line: context.line,
        atRuleContext: [...context.atRuleContext],
        sourceContext: context,
      };

      contexts.push(analysis);
      pushMapValue(indexes.contextsByClassName, context.className, id);
      pushMapValue(indexes.contextsByStylesheetId, stylesheet.id, id);
    }
  }

  sortIndexValues(indexes.contextsByClassName);
  sortIndexValues(indexes.contextsByStylesheetId);
  return contexts.sort(compareById);
}

export function buildUnsupportedClassReferences(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
  includeTraces: boolean,
): UnsupportedClassReferenceAnalysis[] {
  const diagnostics =
    input.unsupportedClassReferences ??
    collectUnsupportedClassReferenceDiagnosticsFromRenderModel(input, includeTraces);

  return diagnostics
    .map((diagnostic, index) => {
      const location = normalizeAnchor(diagnostic.sourceAnchor);
      const sourceFileId =
        indexes.sourceFileIdByPath.get(location.filePath) ??
        createPathId("source", location.filePath);

      return {
        id: createAnchorId("unsupported-class-reference", location, index),
        sourceFileId,
        location,
        rawExpressionText: diagnostic.rawExpressionText,
        reason: diagnostic.reason,
        traces: includeTraces ? [...diagnostic.traces] : [],
        sourceDiagnostic: diagnostic,
      };
    })
    .sort(compareById);
}

function collectUnsupportedClassReferenceDiagnosticsFromRenderModel(
  input: ProjectAnalysisBuildInput,
  includeTraces: boolean,
): UnsupportedClassReferenceDiagnostic[] {
  if (!input.factGraph) {
    return [];
  }

  const modeledSiteNodeIds = new Set(
    input.renderModel.emissionSites.map((emissionSite) => emissionSite.classExpressionSiteNodeId),
  );
  const diagnostics: UnsupportedClassReferenceDiagnostic[] = [];

  for (const site of input.factGraph.graph.nodes.classExpressionSites) {
    if (
      site.classExpressionSiteKind !== "jsx-class" &&
      site.classExpressionSiteKind !== "component-prop-class"
    ) {
      continue;
    }

    if (modeledSiteNodeIds.has(site.id)) {
      continue;
    }

    const location = normalizeAnchor(site.location);
    diagnostics.push({
      sourceAnchor: location,
      rawExpressionText: site.rawExpressionText,
      reason: "raw-jsx-class-not-modeled",
      traces: includeTraces
        ? [
            {
              traceId: `diagnostic:class-reference:unsupported:${location.filePath}:${location.startLine}:${location.startColumn}`,
              category: "render-expansion",
              summary:
                "raw JSX className syntax was present in the source file but was not represented in the render structure",
              anchor: location,
              children: [],
              metadata: {
                reason: "raw-jsx-class-not-modeled",
                rawExpressionText: site.rawExpressionText,
              },
            },
          ]
        : [],
    });
  }

  return diagnostics.sort((left, right) => compareAnchors(left.sourceAnchor, right.sourceAnchor));
}
