import type { RuleDefinitionNode, StyleSheetNode } from "../../fact-graph/index.js";
import type {
  CssAtRuleContextFact,
  CssClassContextFact,
  CssScopeSelectorRequirementFact,
  CssSelectorBranchFact,
} from "../../../types/css.js";
import type {
  RenderGraphProjectionNode,
  RenderModel,
  UnsupportedClassReferenceDiagnostic,
} from "../../render-structure/index.js";
import type {
  ClassContextAnalysis,
  ClassDefinitionAnalysis,
  ComponentAnalysis,
  CssDeclarationAnalysis,
  ProjectEvidenceBuildInput,
  ProjectEvidenceBuilderIndexes,
  ProjectEvidenceStylesheetInput,
  RenderSubtreeAnalysis,
  SelectorBranchAnalysis,
  SourceFileAnalysis,
  StylesheetAnalysis,
  UnsupportedClassReferenceAnalysis,
} from "../analysisTypes.js";
import {
  compareById,
  compareAnchors,
  createAnchorId,
  createClassContextId,
  createClassDefinitionId,
  createCssDeclarationId,
  createComponentId,
  createComponentKey,
  createPathId,
  getDeclarationSignature,
  getDefinitionSelectorKind,
  getSelectorBranchKind,
  getStylesheetOriginFromInventory,
  isCssModuleStylesheetFromInventory,
  normalizeAnchor,
  normalizeOptionalAnchor,
  normalizeOptionalProjectPath,
  normalizeProjectPath,
  pushMapValue,
  sortIndexValues,
  stableHash,
  uniqueSorted,
} from "../internal/shared.js";

export function buildSourceFiles(
  input: ProjectEvidenceBuildInput,
  indexes: ProjectEvidenceBuilderIndexes,
): SourceFileAnalysis[] {
  const sourceFiles: SourceFileAnalysis[] = [];
  const sourcePaths = new Set<string>();

  for (const moduleNode of input.factGraph.graph.nodes.modules) {
    if (moduleNode.moduleKind !== "source") {
      continue;
    }
    sourcePaths.add(normalizeProjectPath(moduleNode.filePath));
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
  indexes: ProjectEvidenceBuilderIndexes,
  input?: ProjectEvidenceBuildInput,
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
  indexes: ProjectEvidenceBuilderIndexes,
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
  input: ProjectEvidenceBuildInput,
  indexes: ProjectEvidenceBuilderIndexes,
): StylesheetAnalysis[] {
  const stylesheetInputsByPath = indexStylesheetInputsByPath(input);
  const stylesheets = input.factGraph.graph.nodes.stylesheets.map((stylesheet, index) => {
    const filePath = normalizeOptionalProjectPath(stylesheet.filePath);
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
  input: ProjectEvidenceBuildInput,
  stylesheets: StylesheetAnalysis[],
  indexes: ProjectEvidenceBuilderIndexes,
): ClassDefinitionAnalysis[] {
  const stylesheetInputsByPath = indexStylesheetInputsByPath(input);
  const stylesheetsByNodeId = new Map<string, StylesheetAnalysis>();
  for (const stylesheetNode of input.factGraph.graph.nodes.stylesheets) {
    const filePath = normalizeOptionalProjectPath(stylesheetNode.filePath);
    const stylesheet = filePath
      ? stylesheets.find((candidate) => candidate.filePath === filePath)
      : stylesheets.find((candidate) => candidate.filePath === undefined);
    if (stylesheet) {
      stylesheetsByNodeId.set(stylesheetNode.id, stylesheet);
    }
  }
  const definitions: ClassDefinitionAnalysis[] = [];

  for (const rule of getRuleDefinitionNodes(input)) {
    const stylesheet = stylesheetsByNodeId.get(rule.stylesheetNodeId);
    if (!stylesheet) {
      continue;
    }

    for (const [branchIndex, branch] of rule.sourceRule.selectorBranches.entries()) {
      const sourceAnchor = normalizeOptionalAnchor(
        rule.sourceRule.selectorEntries[branchIndex]?.selectorAnchor,
      );
      const stylesheetInput = stylesheet.filePath
        ? stylesheetInputsByPath.get(stylesheet.filePath)
        : undefined;
      const sourceFilePath = sourceAnchor ? normalizeProjectPath(sourceAnchor.filePath) : undefined;
      const isCssModuleStylesheet = isCssModuleStylesheetFromInventory(
        stylesheetInput,
        stylesheet.filePath,
      );
      const localModuleClassNames =
        isCssModuleStylesheet && branch.raw.includes(":global(")
          ? branch.contextClassNames.filter(
              (className) => !branch.subjectClassNames.includes(className),
            )
          : [];
      for (const className of uniqueSorted([
        ...branch.subjectClassNames,
        ...localModuleClassNames,
      ])) {
        const definition = {
          className,
          selector: branch.raw,
          selectorBranch: branch,
          ...(sourceAnchor ? { sourceAnchor } : {}),
          declarations: [...new Set(rule.sourceRule.declarations.map((decl) => decl.property))],
          declarationDetails: [...rule.sourceRule.declarations],
          line: sourceAnchor?.startLine ?? rule.sourceRule.line,
          atRuleContext: [...rule.sourceRule.atRuleContext],
        };
        const isLocalModuleContextClass = localModuleClassNames.includes(className);
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
          isCssModule:
            isCssModuleStylesheet &&
            (isLocalModuleContextClass || !definition.selector.includes(":global(")) &&
            (!stylesheet.filePath ||
              !sourceFilePath ||
              sourceFilePath === normalizeProjectPath(stylesheet.filePath)),
          ...(sourceFilePath ? { sourceFilePath } : {}),
          sourceDefinition: definition,
        };

        definitions.push(analysis);
        stylesheet.definitions.push(id);
        pushMapValue(indexes.definitionsByClassName, definition.className, id);
        pushMapValue(indexes.definitionsByStylesheetId, stylesheet.id, id);
      }
    }
  }

  sortIndexValues(indexes.definitionsByClassName);
  sortIndexValues(indexes.definitionsByStylesheetId);
  return definitions.sort(compareById);
}

export function buildCssDeclarations(input: {
  projectInput: ProjectEvidenceBuildInput;
  stylesheets: StylesheetAnalysis[];
  selectorBranches: SelectorBranchAnalysis[];
}): CssDeclarationAnalysis[] {
  const stylesheetsByNodeId = buildStylesheetsByNodeId(input.projectInput, input.stylesheets);
  const selectorBranchIdsByRuleDefinitionNodeId = new Map<string, SelectorBranchAnalysis[]>();
  for (const branch of input.selectorBranches) {
    if (!branch.ruleDefinitionNodeId) {
      continue;
    }
    const branches = selectorBranchIdsByRuleDefinitionNodeId.get(branch.ruleDefinitionNodeId) ?? [];
    branches.push(branch);
    selectorBranchIdsByRuleDefinitionNodeId.set(branch.ruleDefinitionNodeId, branches);
  }

  const ruleSourceOrderById = new Map<string, number>();
  const nextRuleSourceOrderByStylesheetNodeId = new Map<string, number>();
  for (const rule of getRuleDefinitionNodes(input.projectInput)
    .slice()
    .sort(compareRuleDefinitionNodes)) {
    const nextOrder = nextRuleSourceOrderByStylesheetNodeId.get(rule.stylesheetNodeId) ?? 0;
    ruleSourceOrderById.set(rule.id, nextOrder);
    nextRuleSourceOrderByStylesheetNodeId.set(rule.stylesheetNodeId, nextOrder + 1);
  }

  const declarations: CssDeclarationAnalysis[] = [];
  for (const rule of getRuleDefinitionNodes(input.projectInput)) {
    const stylesheet = stylesheetsByNodeId.get(rule.stylesheetNodeId);
    if (!stylesheet) {
      continue;
    }

    const selectorBranches = (selectorBranchIdsByRuleDefinitionNodeId.get(rule.id) ?? []).sort(
      compareById,
    );
    const selectorBranchIds = selectorBranches.map((branch) => branch.id);
    const selectorQueryIds = uniqueSorted(selectorBranches.map((branch) => branch.selectorQueryId));

    for (const [declarationIndex, declaration] of rule.sourceRule.declarations.entries()) {
      const location = normalizeOptionalAnchor(declaration.sourceAnchor);
      const analysis: CssDeclarationAnalysis = {
        id: createCssDeclarationId({
          stylesheetId: stylesheet.id,
          ruleDefinitionNodeId: rule.id,
          declarationIndex,
          property: declaration.property,
          location,
        }),
        stylesheetId: stylesheet.id,
        ruleDefinitionNodeId: rule.id,
        ...(selectorQueryIds[0] ? { selectorQueryId: selectorQueryIds[0] } : {}),
        selectorBranchIds,
        selectorText: rule.sourceRule.selector,
        declarationIndex,
        ruleSourceOrder: ruleSourceOrderById.get(rule.id) ?? 0,
        property: declaration.property,
        value: declaration.value,
        ...(declaration.propertyEffects
          ? { propertyEffects: declaration.propertyEffects.map((effect) => ({ ...effect })) }
          : {}),
        important: declaration.important ?? false,
        ...(location ? { location } : {}),
        atRuleContext: [...rule.sourceRule.atRuleContext],
        sourceDeclaration: { ...declaration },
      };

      declarations.push(analysis);
    }
  }

  return declarations.sort(compareById);
}

function indexStylesheetInputsByPath(
  input: ProjectEvidenceBuildInput,
): Map<string, ProjectEvidenceStylesheetInput> {
  const stylesheetsByPath = new Map<string, ProjectEvidenceStylesheetInput>();
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
): ProjectEvidenceStylesheetInput {
  return {
    filePath,
    cssKind: stylesheet.cssKind,
    origin: stylesheet.origin,
  };
}

export function buildClassContexts(
  input: ProjectEvidenceBuildInput,
  stylesheets: StylesheetAnalysis[],
  indexes: ProjectEvidenceBuilderIndexes,
): ClassContextAnalysis[] {
  const stylesheetsByNodeId = new Map<string, StylesheetAnalysis>();
  for (const stylesheetNode of input.factGraph.graph.nodes.stylesheets) {
    const filePath = normalizeOptionalProjectPath(stylesheetNode.filePath);
    const stylesheet = filePath
      ? stylesheets.find((candidate) => candidate.filePath === filePath)
      : stylesheets.find((candidate) => candidate.filePath === undefined);
    if (stylesheet) {
      stylesheetsByNodeId.set(stylesheetNode.id, stylesheet);
    }
  }
  const contexts: ClassContextAnalysis[] = [];
  const scopeContextIds = new Set<string>();

  for (const rule of getRuleDefinitionNodes(input)) {
    const stylesheet = stylesheetsByNodeId.get(rule.stylesheetNodeId);
    if (!stylesheet) {
      continue;
    }

    for (const branch of rule.sourceRule.selectorBranches) {
      for (const className of uniqueSorted([
        ...branch.contextClassNames,
        ...branch.negativeClassNames,
      ])) {
        const context = {
          className,
          selector: branch.raw,
          selectorBranch: branch,
          line: rule.sourceRule.line,
          atRuleContext: [...rule.sourceRule.atRuleContext],
        };
        const id = createClassContextId(stylesheet.id, context);
        const analysis: ClassContextAnalysis = {
          id,
          stylesheetId: stylesheet.id,
          sourceKind: "css-rule",
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

    for (const context of buildScopeRequirementClassContexts(rule.sourceRule.atRuleContext)) {
      const sourceContext = {
        ...context,
        line: rule.sourceRule.line,
        atRuleContext: [...rule.sourceRule.atRuleContext],
      };
      const id = createClassContextId(stylesheet.id, sourceContext);
      if (scopeContextIds.has(id)) {
        continue;
      }
      scopeContextIds.add(id);

      const analysis: ClassContextAnalysis = {
        id,
        stylesheetId: stylesheet.id,
        sourceKind: "css-rule",
        className: sourceContext.className,
        selectorText: sourceContext.selector,
        selectorKind: getSelectorBranchKind(sourceContext.selectorBranch),
        line: sourceContext.line,
        atRuleContext: [...sourceContext.atRuleContext],
        sourceContext,
      };

      contexts.push(analysis);
      pushMapValue(indexes.contextsByClassName, sourceContext.className, id);
      pushMapValue(indexes.contextsByStylesheetId, stylesheet.id, id);
    }
  }

  for (const sourceFile of input.factGraph.frontends.source.files) {
    for (const selectorFact of sourceFile.cssInJsSelectors) {
      for (const branch of selectorFact.selectorBranches) {
        for (const className of uniqueSorted([
          ...branch.requiredClassNames,
          ...branch.contextClassNames,
        ])) {
          const context = {
            className,
            selector: branch.raw,
            selectorBranch: branch,
            line: selectorFact.location.startLine,
            atRuleContext: [],
          };
          const id = [
            "class-context",
            "css-in-js",
            normalizeProjectPath(selectorFact.filePath),
            className,
            selectorFact.location.startLine,
            selectorFact.location.startColumn,
            stableHash(`${branch.raw}:${selectorFact.hostKind}`),
          ].join(":");
          const analysis: ClassContextAnalysis = {
            id,
            sourceKind: "css-in-js",
            className: context.className,
            selectorText: context.selector,
            selectorKind: getSelectorBranchKind(context.selectorBranch),
            line: context.line,
            atRuleContext: [],
            sourceContext: context,
          };

          contexts.push(analysis);
          pushMapValue(indexes.contextsByClassName, context.className, id);
        }
      }
    }
  }

  sortIndexValues(indexes.contextsByClassName);
  sortIndexValues(indexes.contextsByStylesheetId);
  return contexts.sort(compareById);
}

function buildScopeRequirementClassContexts(
  atRuleContext: CssAtRuleContextFact[],
): Array<Omit<CssClassContextFact, "line" | "atRuleContext">> {
  const contexts: Array<Omit<CssClassContextFact, "line" | "atRuleContext">> = [];

  for (const scopeContext of atRuleContext) {
    if (scopeContext.name !== "scope" || scopeContext.scopeSupported !== true) {
      continue;
    }

    for (const requirement of [
      ...getScopeRequirements(scopeContext.scopeRootRequirements, scopeContext.scopeRootClassName),
      ...getScopeRequirements(
        scopeContext.scopeLimitRequirements,
        scopeContext.scopeLimitClassName,
      ),
    ]) {
      const requiredClassNames = uniqueSorted(requirement.requiredClassNames);
      if (requiredClassNames.length === 0) {
        continue;
      }

      const selectorBranch = createScopeRequirementSelectorBranch(requirement, requiredClassNames);
      for (const className of requiredClassNames) {
        contexts.push({
          className,
          selector: requirement.selectorText,
          selectorBranch,
        });
      }
    }
  }

  return contexts;
}

function getScopeRequirements(
  requirements: CssScopeSelectorRequirementFact[] | undefined,
  legacyClassName: string | undefined,
): CssScopeSelectorRequirementFact[] {
  if (requirements) {
    return requirements.filter((requirement) => requirement.requiredClassNames.length > 0);
  }

  return legacyClassName
    ? [
        {
          selectorText: `.${legacyClassName}`,
          requiredClassNames: [legacyClassName],
        },
      ]
    : [];
}

function createScopeRequirementSelectorBranch(
  requirement: CssScopeSelectorRequirementFact,
  requiredClassNames: string[],
): CssSelectorBranchFact {
  return {
    raw: requirement.selectorText,
    matchKind: requiredClassNames.length > 1 ? "compound" : "standalone",
    subjectClassNames: [...requiredClassNames],
    classAttributePredicates: [],
    attributePredicates: [],
    requiredClassNames: [...requiredClassNames],
    contextClassNames: [],
    negativeClassNames: [...(requirement.forbiddenClassNames ?? [])].sort((left, right) =>
      left.localeCompare(right),
    ),
    hasDescendantClassNames: [],
    hasCombinators: false,
    hasSubjectModifiers: false,
    hasUnknownSemantics: false,
  };
}

function buildStylesheetsByNodeId(
  input: ProjectEvidenceBuildInput,
  stylesheets: StylesheetAnalysis[],
): Map<string, StylesheetAnalysis> {
  const stylesheetsByNodeId = new Map<string, StylesheetAnalysis>();
  for (const stylesheetNode of input.factGraph.graph.nodes.stylesheets) {
    const filePath = normalizeOptionalProjectPath(stylesheetNode.filePath);
    const stylesheet = filePath
      ? stylesheets.find((candidate) => candidate.filePath === filePath)
      : stylesheets.find((candidate) => candidate.filePath === undefined);
    if (stylesheet) {
      stylesheetsByNodeId.set(stylesheetNode.id, stylesheet);
    }
  }
  return stylesheetsByNodeId;
}

function compareRuleDefinitionNodes(left: RuleDefinitionNode, right: RuleDefinitionNode): number {
  const leftAnchor = normalizeOptionalAnchor(left.sourceRule.selectorEntries[0]?.selectorAnchor);
  const rightAnchor = normalizeOptionalAnchor(right.sourceRule.selectorEntries[0]?.selectorAnchor);

  if (left.stylesheetNodeId !== right.stylesheetNodeId) {
    return left.stylesheetNodeId.localeCompare(right.stylesheetNodeId);
  }
  if (leftAnchor && rightAnchor) {
    return compareAnchors(leftAnchor, rightAnchor) || left.id.localeCompare(right.id);
  }
  return left.sourceRule.line - right.sourceRule.line || left.id.localeCompare(right.id);
}

function getRuleDefinitionNodes(input: ProjectEvidenceBuildInput): RuleDefinitionNode[] {
  return input.factGraph.graph.nodes.ruleDefinitions;
}

export function buildUnsupportedClassReferences(
  input: ProjectEvidenceBuildInput,
  indexes: ProjectEvidenceBuilderIndexes,
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
  input: ProjectEvidenceBuildInput,
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

    if (site.classExpressionSiteKind === "component-prop-class") {
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
