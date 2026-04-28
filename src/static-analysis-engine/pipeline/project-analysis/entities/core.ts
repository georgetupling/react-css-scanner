import type { RenderGraphNode } from "../../render-model/render-graph/types.js";
import type { RenderSubtree } from "../../render-model/render-ir/types.js";
import { getAllResolvedModuleFacts } from "../../module-facts/index.js";
import type {
  ClassContextAnalysis,
  ClassDefinitionAnalysis,
  ComponentAnalysis,
  ProjectAnalysisBuildInput,
  ProjectAnalysisIndexes,
  RenderSubtreeAnalysis,
  SourceFileAnalysis,
  StylesheetAnalysis,
  UnsupportedClassReferenceAnalysis,
} from "../types.js";
import {
  compareById,
  createAnchorId,
  createClassContextId,
  createClassDefinitionId,
  createComponentId,
  createComponentKey,
  createPathId,
  getDeclarationSignature,
  getDefinitionSelectorKind,
  getSelectorBranchKind,
  getStylesheetOrigin,
  isCssModuleStylesheet,
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

  for (const moduleFacts of getAllResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
  })) {
    sourcePaths.add(normalizeProjectPath(moduleFacts.filePath));
  }

  for (const renderSubtree of input.renderSubtrees) {
    sourcePaths.add(normalizeProjectPath(renderSubtree.sourceAnchor.filePath));
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
  renderGraphNodes: RenderGraphNode[],
  indexes: ProjectAnalysisIndexes,
): ComponentAnalysis[] {
  const components = renderGraphNodes.map((node) => {
    const filePath = normalizeProjectPath(node.filePath);
    const id = createComponentId(filePath, node.componentName);
    indexes.componentIdByComponentKey.set(node.componentKey, id);
    indexes.componentIdByFilePathAndName.set(createComponentKey(filePath, node.componentName), id);

    return {
      id,
      componentKey: node.componentKey,
      filePath,
      componentName: node.componentName,
      exported: node.exported,
      location: normalizeAnchor(node.sourceAnchor),
    };
  });

  return components.sort(compareById);
}

export function buildRenderSubtrees(
  renderSubtrees: RenderSubtree[],
  indexes: ProjectAnalysisIndexes,
): RenderSubtreeAnalysis[] {
  return renderSubtrees
    .map((renderSubtree, index) => {
      const filePath = normalizeProjectPath(renderSubtree.sourceAnchor.filePath);
      const componentId = renderSubtree.componentName
        ? renderSubtree.componentKey
          ? indexes.componentIdByComponentKey.get(renderSubtree.componentKey)
          : indexes.componentIdByFilePathAndName.get(
              createComponentKey(filePath, renderSubtree.componentName),
            )
        : undefined;

      return {
        id: createAnchorId("render-subtree", renderSubtree.sourceAnchor, index),
        componentId,
        componentKey: renderSubtree.componentKey,
        filePath,
        componentName: renderSubtree.componentName,
        exported: renderSubtree.exported,
        location: normalizeAnchor(renderSubtree.sourceAnchor),
        sourceSubtree: renderSubtree,
      };
    })
    .sort(compareById);
}

export function buildStylesheets(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
): StylesheetAnalysis[] {
  const stylesheets = input.cssFiles.map((cssFile, index) => {
    const filePath = normalizeOptionalProjectPath(cssFile.filePath);
    const id = filePath ? createPathId("stylesheet", filePath) : `stylesheet:anonymous:${index}`;
    if (filePath) {
      indexes.stylesheetIdByPath.set(filePath, id);
    }

    return {
      id,
      filePath,
      origin: getStylesheetOrigin(filePath, input),
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
        isCssModule: isCssModuleStylesheet(stylesheet.filePath),
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
  return input.unsupportedClassReferences
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
