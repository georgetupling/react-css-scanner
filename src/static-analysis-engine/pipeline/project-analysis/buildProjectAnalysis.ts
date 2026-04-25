import type {
  ClassDefinitionAnalysis,
  ClassOwnershipAnalysis,
  ClassDefinitionSelectorKind,
  ClassReferenceAnalysis,
  ClassReferenceExpressionKind,
  ClassReferenceMatchRelation,
  OwnerCandidate,
  OwnerCandidateReason,
  ComponentAnalysis,
  ComponentRenderRelation,
  CssModuleAliasAnalysis,
  CssModuleDestructuredBindingAnalysis,
  CssModuleImportAnalysis,
  CssModuleMemberMatchRelation,
  CssModuleMemberReferenceAnalysis,
  CssModuleNamedImportBindingAnalysis,
  CssModuleReferenceDiagnosticAnalysis,
  DeclarationForSignature,
  ModuleImportRelation,
  ProjectAnalysis,
  ProjectAnalysisBuildInput,
  ProjectAnalysisId,
  ProjectAnalysisIndexes,
  ProviderClassSatisfactionRelation,
  RenderSubtreeAnalysis,
  SelectorMatchRelation,
  SelectorBranchAnalysis,
  SelectorQueryAnalysis,
  SourceFileAnalysis,
  StylesheetAnalysis,
  StylesheetOrigin,
  StylesheetReachabilityRelation,
  UnsupportedClassReferenceAnalysis,
} from "./types.js";
import type { ClassExpressionSummary } from "../render-model/abstract-values/types.js";
import type { ReachabilityAvailability } from "../reachability/types.js";
import type { RenderGraphEdge, RenderGraphNode } from "../render-model/render-graph/types.js";
import type {
  RenderElementNode,
  RenderNode,
  RenderSubtree,
} from "../render-model/render-ir/types.js";
import type { SelectorQueryResult } from "../selector-analysis/types.js";
import type { AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";

export function buildProjectAnalysis(input: ProjectAnalysisBuildInput): ProjectAnalysis {
  const indexes = createEmptyIndexes();
  const sourceFiles = buildSourceFiles(input, indexes);
  const components = buildComponents(input.renderGraph.nodes, indexes);
  const renderSubtrees = buildRenderSubtrees(input.renderSubtrees, indexes);
  const stylesheets = buildStylesheets(input, indexes);
  const classDefinitions = buildClassDefinitions(input, stylesheets, indexes);
  const unsupportedClassReferences = buildUnsupportedClassReferences(input, indexes);
  const selectorQueries = buildSelectorQueries(input.selectorQueryResults, stylesheets, indexes);
  const selectorBranches = buildSelectorBranches(selectorQueries);
  const cssModuleImports = buildCssModuleImports(input, indexes);
  const {
    namedImportBindings: cssModuleNamedImportBindings,
    aliases: cssModuleAliases,
    destructuredBindings: cssModuleDestructuredBindings,
    memberReferences: cssModuleMemberReferences,
    diagnostics: cssModuleReferenceDiagnostics,
  } = buildCssModuleMemberReferences({
    projectInput: input,
    imports: cssModuleImports,
    indexes,
  });
  const cssModuleMemberMatches = buildCssModuleMemberMatches({
    references: cssModuleMemberReferences,
    indexes,
    localsConvention: input.cssModules.options.localsConvention,
  });
  const classReferences = [
    ...buildClassReferences(renderSubtrees, indexes),
    ...buildCssModuleClassReferences({
      memberReferences: cssModuleMemberReferences,
      memberMatches: cssModuleMemberMatches,
      indexes,
    }),
  ].sort(compareById);
  indexEntities({
    sourceFiles,
    stylesheets,
    classReferences,
    classDefinitions,
    selectorQueries,
    selectorBranches,
    components,
    unsupportedClassReferences,
    cssModuleImports,
    cssModuleNamedImportBindings,
    cssModuleAliases,
    cssModuleDestructuredBindings,
    cssModuleMemberReferences,
    cssModuleReferenceDiagnostics,
    indexes,
  });
  const stylesheetReachability = buildStylesheetReachability(input, indexes);
  const referenceMatches = buildReferenceMatches({
    references: classReferences,
    definitions: classDefinitions,
    reachability: stylesheetReachability,
    cssModuleMemberMatches,
    indexes,
  });
  const providerClassSatisfactions = buildProviderClassSatisfactions({
    references: classReferences,
    input,
  });
  const selectorMatches = buildSelectorMatches(selectorQueries);
  const classOwnership = buildClassOwnership({
    input,
    definitions: classDefinitions,
    references: classReferences,
    components,
    stylesheets,
    referenceMatches,
    indexes,
  });

  indexRelations({
    referenceMatches,
    providerClassSatisfactions,
    selectorMatches,
    cssModuleMemberMatches,
    indexes,
  });
  indexClassOwnership(classOwnership, indexes);

  return {
    meta: {
      sourceFileCount: sourceFiles.length,
      cssFileCount: stylesheets.length,
      externalCssEnabled: input.externalCssSummary.enabled,
    },
    inputs: {
      sourceFiles: sourceFiles.map(({ id, filePath }) => ({ id, filePath })),
      cssFiles: stylesheets.map(({ id, filePath }) => ({ id, filePath })),
      externalCss: input.externalCssSummary,
    },
    entities: {
      sourceFiles,
      stylesheets,
      classReferences,
      classDefinitions,
      selectorQueries,
      selectorBranches,
      classOwnership,
      components,
      renderSubtrees,
      unsupportedClassReferences,
      cssModuleImports,
      cssModuleNamedImportBindings,
      cssModuleAliases,
      cssModuleDestructuredBindings,
      cssModuleMemberReferences,
      cssModuleReferenceDiagnostics,
    },
    relations: {
      moduleImports: buildModuleImports(input, indexes),
      componentRenders: buildComponentRenders(input.renderGraph.edges, indexes),
      stylesheetReachability,
      referenceMatches,
      selectorMatches,
      providerClassSatisfactions,
      cssModuleMemberMatches,
    },
    indexes,
  };
}

function buildSourceFiles(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
): SourceFileAnalysis[] {
  const sourceFiles: SourceFileAnalysis[] = [];
  const sourcePaths = new Set<string>();

  for (const moduleNode of input.moduleGraph.modulesById.values()) {
    if (moduleNode.kind === "source") {
      sourcePaths.add(normalizeProjectPath(moduleNode.filePath));
    }
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

function buildComponents(
  renderGraphNodes: RenderGraphNode[],
  indexes: ProjectAnalysisIndexes,
): ComponentAnalysis[] {
  const components = renderGraphNodes.map((node) => {
    const filePath = normalizeProjectPath(node.filePath);
    const id = createComponentId(filePath, node.componentName);
    indexes.componentIdByFilePathAndName.set(createComponentKey(filePath, node.componentName), id);

    return {
      id,
      filePath,
      componentName: node.componentName,
      exported: node.exported,
      location: normalizeAnchor(node.sourceAnchor),
    };
  });

  return components.sort(compareById);
}

function buildRenderSubtrees(
  renderSubtrees: RenderSubtree[],
  indexes: ProjectAnalysisIndexes,
): RenderSubtreeAnalysis[] {
  return renderSubtrees
    .map((renderSubtree, index) => {
      const filePath = normalizeProjectPath(renderSubtree.sourceAnchor.filePath);
      const componentId = renderSubtree.componentName
        ? indexes.componentIdByFilePathAndName.get(
            createComponentKey(filePath, renderSubtree.componentName),
          )
        : undefined;

      return {
        id: createAnchorId("render-subtree", renderSubtree.sourceAnchor, index),
        componentId,
        filePath,
        componentName: renderSubtree.componentName,
        exported: renderSubtree.exported,
        location: normalizeAnchor(renderSubtree.sourceAnchor),
        sourceSubtree: renderSubtree,
      };
    })
    .sort(compareById);
}

function buildStylesheets(
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

function buildClassDefinitions(
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
      indexes.classDefinitionsById.set(id, analysis);
      pushMapValue(indexes.definitionsByClassName, definition.className, id);
      pushMapValue(indexes.definitionsByStylesheetId, stylesheet.id, id);
    }
  }

  sortIndexValues(indexes.definitionsByClassName);
  sortIndexValues(indexes.definitionsByStylesheetId);
  return definitions.sort(compareById);
}

function buildClassReferences(
  renderSubtrees: RenderSubtreeAnalysis[],
  indexes: ProjectAnalysisIndexes,
): ClassReferenceAnalysis[] {
  const classExpressions = deduplicateRenderClassExpressions(
    renderSubtrees.flatMap((renderSubtree) => collectRenderClassExpressions(renderSubtree)),
  );

  const references = classExpressions.map((entry, index) => {
    const { classExpression, emittedElementLocation, placementLocation, renderSubtreeId } = entry;
    const filePath = normalizeProjectPath(classExpression.sourceAnchor.filePath);
    const sourceFileId =
      indexes.sourceFileIdByPath.get(filePath) ?? createPathId("source", filePath);
    const componentId = entry.componentId;
    const id = createAnchorId("class-reference", classExpression.sourceAnchor, index);
    const reference: ClassReferenceAnalysis = {
      id,
      sourceFileId,
      componentId,
      renderSubtreeId,
      location: normalizeAnchor(classExpression.sourceAnchor),
      emittedElementLocation,
      placementLocation,
      origin: "render-ir",
      expressionKind: getReferenceExpressionKind(classExpression),
      rawExpressionText: classExpression.sourceText,
      definiteClassNames: [...classExpression.classes.definite],
      possibleClassNames: [...classExpression.classes.possible],
      unknownDynamic: classExpression.classes.unknownDynamic,
      confidence: getReferenceConfidence(classExpression),
      traces: buildClassReferenceTraces(entry),
      sourceSummary: classExpression,
    };

    pushMapValue(indexes.referencesBySourceFileId, sourceFileId, id);
    for (const className of collectReferenceClassNames(reference)) {
      pushMapValue(indexes.referencesByClassName, className, id);
    }

    return reference;
  });

  sortIndexValues(indexes.referencesBySourceFileId);
  sortIndexValues(indexes.referencesByClassName);
  return references.sort(compareById);
}

function buildCssModuleClassReferences(input: {
  memberReferences: CssModuleMemberReferenceAnalysis[];
  memberMatches: CssModuleMemberMatchRelation[];
  indexes: ProjectAnalysisIndexes;
}): ClassReferenceAnalysis[] {
  const matchesByReferenceId = new Map<ProjectAnalysisId, CssModuleMemberMatchRelation>();
  for (const match of input.memberMatches) {
    matchesByReferenceId.set(match.referenceId, match);
  }

  const references = input.memberReferences.map((memberReference) => {
    const match = matchesByReferenceId.get(memberReference.id);
    const className = match?.className ?? memberReference.memberName;
    const reference: ClassReferenceAnalysis = {
      id: `class-reference:css-module-member:${memberReference.id}`,
      sourceFileId: memberReference.sourceFileId,
      location: normalizeAnchor(memberReference.location),
      origin: "css-module-member",
      expressionKind: "exact-string",
      rawExpressionText: memberReference.rawExpressionText,
      definiteClassNames: [className],
      possibleClassNames: [],
      unknownDynamic: false,
      confidence: "high",
      traces: buildCssModuleClassReferenceTraces({
        memberReference,
        className,
      }),
      sourceCssModuleMemberReferenceId: memberReference.id,
    };

    pushMapValue(input.indexes.referencesBySourceFileId, reference.sourceFileId, reference.id);
    pushMapValue(input.indexes.referencesByClassName, className, reference.id);

    return reference;
  });

  sortIndexValues(input.indexes.referencesBySourceFileId);
  sortIndexValues(input.indexes.referencesByClassName);
  return references.sort(compareById);
}

function buildUnsupportedClassReferences(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
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
        traces: [...diagnostic.traces],
        sourceDiagnostic: diagnostic,
      };
    })
    .sort(compareById);
}

function buildCssModuleImports(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
): CssModuleImportAnalysis[] {
  return input.cssModules.imports
    .map((cssModuleImport) => {
      const sourceFilePath = normalizeProjectPath(cssModuleImport.sourceFilePath);
      const stylesheetFilePath = normalizeProjectPath(cssModuleImport.stylesheetFilePath);
      const sourceFileId = indexes.sourceFileIdByPath.get(sourceFilePath);
      const stylesheetId = indexes.stylesheetIdByPath.get(stylesheetFilePath);

      if (!sourceFileId || !stylesheetId) {
        return undefined;
      }

      return {
        id: createCssModuleImportId({
          sourceFilePath,
          stylesheetFilePath,
          localName: cssModuleImport.localName,
        }),
        sourceFileId,
        stylesheetId,
        sourceFilePath,
        stylesheetFilePath,
        specifier: cssModuleImport.specifier,
        importedName: cssModuleImport.importedName,
        localName: cssModuleImport.localName,
        importKind: cssModuleImport.importKind,
      };
    })
    .filter((cssModuleImport): cssModuleImport is CssModuleImportAnalysis =>
      Boolean(cssModuleImport),
    )
    .sort(compareById);
}

function buildCssModuleMemberReferences(input: {
  projectInput: ProjectAnalysisBuildInput;
  imports: CssModuleImportAnalysis[];
  indexes: ProjectAnalysisIndexes;
}): {
  namedImportBindings: CssModuleNamedImportBindingAnalysis[];
  aliases: CssModuleAliasAnalysis[];
  destructuredBindings: CssModuleDestructuredBindingAnalysis[];
  memberReferences: CssModuleMemberReferenceAnalysis[];
  diagnostics: CssModuleReferenceDiagnosticAnalysis[];
} {
  const importsBySourceStylesheetAndLocalName = new Map<string, CssModuleImportAnalysis>();
  for (const cssModuleImport of input.imports) {
    importsBySourceStylesheetAndLocalName.set(
      createCssModuleImportLookupKey({
        sourceFilePath: cssModuleImport.sourceFilePath,
        stylesheetFilePath: cssModuleImport.stylesheetFilePath,
        localName: cssModuleImport.localName,
      }),
      cssModuleImport,
    );
  }

  return {
    namedImportBindings: input.projectInput.cssModules.namedImportBindings
      .map((binding) => {
        const cssModuleImport = importsBySourceStylesheetAndLocalName.get(
          createCssModuleImportLookupKey(binding),
        );
        if (!cssModuleImport) {
          return undefined;
        }

        return {
          id: createCssModuleNamedImportBindingId(
            binding.location,
            cssModuleImport.id,
            binding.importedName,
            binding.localName,
          ),
          importId: cssModuleImport.id,
          sourceFileId: cssModuleImport.sourceFileId,
          stylesheetId: cssModuleImport.stylesheetId,
          specifier: binding.specifier,
          importedName: binding.importedName,
          localName: binding.localName,
          location: normalizeAnchor(binding.location),
          rawExpressionText: binding.rawExpressionText,
          traces: [...binding.traces],
        };
      })
      .filter((binding): binding is CssModuleNamedImportBindingAnalysis => Boolean(binding))
      .sort(compareById),
    aliases: input.projectInput.cssModules.aliases
      .map((alias) => {
        const cssModuleImport = importsBySourceStylesheetAndLocalName.get(
          createCssModuleImportLookupKey(alias),
        );
        if (!cssModuleImport) {
          return undefined;
        }

        return {
          id: createCssModuleAliasId(alias.location, cssModuleImport.id, alias.aliasName),
          importId: cssModuleImport.id,
          sourceFileId: cssModuleImport.sourceFileId,
          stylesheetId: cssModuleImport.stylesheetId,
          localName: alias.localName,
          aliasName: alias.aliasName,
          location: normalizeAnchor(alias.location),
          rawExpressionText: alias.rawExpressionText,
          traces: [...alias.traces],
        };
      })
      .filter((alias): alias is CssModuleAliasAnalysis => Boolean(alias))
      .sort(compareById),
    destructuredBindings: input.projectInput.cssModules.destructuredBindings
      .map((binding) => {
        const cssModuleImport = importsBySourceStylesheetAndLocalName.get(
          createCssModuleImportLookupKey(binding),
        );
        if (!cssModuleImport) {
          return undefined;
        }

        return {
          id: createCssModuleDestructuredBindingId(
            binding.location,
            cssModuleImport.id,
            binding.memberName,
            binding.bindingName,
          ),
          importId: cssModuleImport.id,
          sourceFileId: cssModuleImport.sourceFileId,
          stylesheetId: cssModuleImport.stylesheetId,
          localName: binding.localName,
          memberName: binding.memberName,
          bindingName: binding.bindingName,
          location: normalizeAnchor(binding.location),
          rawExpressionText: binding.rawExpressionText,
          traces: [...binding.traces],
        };
      })
      .filter((binding): binding is CssModuleDestructuredBindingAnalysis => Boolean(binding))
      .sort(compareById),
    memberReferences: input.projectInput.cssModules.memberReferences
      .map((reference) => {
        const cssModuleImport = importsBySourceStylesheetAndLocalName.get(
          createCssModuleImportLookupKey(reference),
        );
        if (!cssModuleImport) {
          return undefined;
        }

        return {
          id: createCssModuleMemberReferenceId(
            reference.location,
            cssModuleImport.id,
            reference.memberName,
          ),
          importId: cssModuleImport.id,
          sourceFileId: cssModuleImport.sourceFileId,
          stylesheetId: cssModuleImport.stylesheetId,
          localName: reference.localName,
          memberName: reference.memberName,
          accessKind: reference.accessKind,
          location: normalizeAnchor(reference.location),
          rawExpressionText: reference.rawExpressionText,
          traces: [...reference.traces],
        };
      })
      .filter((reference): reference is CssModuleMemberReferenceAnalysis => Boolean(reference))
      .sort(compareById),
    diagnostics: input.projectInput.cssModules.diagnostics
      .map((diagnostic) => {
        const cssModuleImport = importsBySourceStylesheetAndLocalName.get(
          createCssModuleImportLookupKey(diagnostic),
        );
        if (!cssModuleImport) {
          return undefined;
        }

        return {
          id: createCssModuleDiagnosticId(diagnostic.location, cssModuleImport.id),
          importId: cssModuleImport.id,
          sourceFileId: cssModuleImport.sourceFileId,
          stylesheetId: cssModuleImport.stylesheetId,
          localName: diagnostic.localName,
          reason: diagnostic.reason,
          location: normalizeAnchor(diagnostic.location),
          rawExpressionText: diagnostic.rawExpressionText,
          traces: [...diagnostic.traces],
        };
      })
      .filter((diagnostic): diagnostic is CssModuleReferenceDiagnosticAnalysis =>
        Boolean(diagnostic),
      )
      .sort(compareById),
  };
}

type RenderClassExpressionEntry = {
  classExpression: ClassExpressionSummary;
  componentId?: ProjectAnalysisId;
  renderSubtreeId: ProjectAnalysisId;
  emittedElementLocation: SourceAnchor;
  placementLocation?: SourceAnchor;
};

function collectRenderClassExpressions(input: RenderSubtreeAnalysis): RenderClassExpressionEntry[] {
  const entries: RenderClassExpressionEntry[] = [];

  visitRenderNode(input.sourceSubtree.root, undefined, (node, inheritedPlacementLocation) => {
    if (!node.className) {
      return;
    }

    entries.push({
      classExpression: node.className,
      componentId: input.componentId,
      renderSubtreeId: input.id,
      emittedElementLocation: normalizeAnchor(node.sourceAnchor),
      placementLocation: normalizeOptionalAnchor(
        node.placementAnchor ?? inheritedPlacementLocation,
      ),
    });
  });

  return entries.sort((left, right) =>
    `${left.classExpression.sourceAnchor.filePath}:${left.classExpression.sourceAnchor.startLine}:${left.classExpression.sourceAnchor.startColumn}`.localeCompare(
      `${right.classExpression.sourceAnchor.filePath}:${right.classExpression.sourceAnchor.startLine}:${right.classExpression.sourceAnchor.startColumn}`,
    ),
  );
}

function deduplicateRenderClassExpressions(
  entries: RenderClassExpressionEntry[],
): RenderClassExpressionEntry[] {
  const entriesByKey = new Map<string, RenderClassExpressionEntry>();

  for (const entry of entries) {
    const key = createRenderClassExpressionDedupeKey(entry);
    const existing = entriesByKey.get(key);
    if (!existing || compareRenderClassExpressionEntries(entry, existing) < 0) {
      entriesByKey.set(key, entry);
    }
  }

  return [...entriesByKey.values()].sort(compareRenderClassExpressionEntries);
}

function createRenderClassExpressionDedupeKey(entry: RenderClassExpressionEntry): string {
  const classExpression = entry.classExpression;
  return [
    normalizeProjectPath(classExpression.sourceAnchor.filePath),
    classExpression.sourceAnchor.startLine,
    classExpression.sourceAnchor.startColumn,
    classExpression.sourceAnchor.endLine ?? "",
    classExpression.sourceAnchor.endColumn ?? "",
    classExpression.classes.definite.join(" "),
    classExpression.classes.possible.join(" "),
    classExpression.classes.unknownDynamic ? "dynamic" : "static",
  ].join(":");
}

function compareRenderClassExpressionEntries(
  left: RenderClassExpressionEntry,
  right: RenderClassExpressionEntry,
): number {
  return (
    compareAnchors(left.classExpression.sourceAnchor, right.classExpression.sourceAnchor) ||
    compareAnchors(left.emittedElementLocation, right.emittedElementLocation) ||
    (left.placementLocation && right.placementLocation
      ? compareAnchors(left.placementLocation, right.placementLocation)
      : left.placementLocation
        ? -1
        : right.placementLocation
          ? 1
          : 0) ||
    left.renderSubtreeId.localeCompare(right.renderSubtreeId)
  );
}

function buildClassReferenceTraces(entry: RenderClassExpressionEntry): AnalysisTrace[] {
  return [
    {
      traceId: `render-expansion:class-reference:${normalizeProjectPath(entry.classExpression.sourceAnchor.filePath)}:${entry.classExpression.sourceAnchor.startLine}:${entry.classExpression.sourceAnchor.startColumn}`,
      category: "render-expansion",
      summary: "class reference was collected from the render IR",
      anchor: normalizeAnchor(entry.emittedElementLocation),
      children: [...entry.classExpression.traces],
      metadata: {
        renderSubtreeId: entry.renderSubtreeId,
        componentId: entry.componentId,
        sourceFilePath: normalizeProjectPath(entry.classExpression.sourceAnchor.filePath),
        emittedElementFilePath: normalizeProjectPath(entry.emittedElementLocation.filePath),
        placementFilePath: entry.placementLocation
          ? normalizeProjectPath(entry.placementLocation.filePath)
          : undefined,
      },
    },
  ];
}

function buildCssModuleClassReferenceTraces(input: {
  memberReference: CssModuleMemberReferenceAnalysis;
  className: string;
}): AnalysisTrace[] {
  return [
    {
      traceId: `css-module:class-reference:${input.memberReference.id}:${input.className}`,
      category: "value-evaluation",
      summary: `CSS Module member "${input.memberReference.memberName}" was projected as class reference "${input.className}"`,
      anchor: input.memberReference.location,
      children: [...input.memberReference.traces],
      metadata: {
        origin: "css-module-member",
        memberReferenceId: input.memberReference.id,
        memberName: input.memberReference.memberName,
        className: input.className,
        accessKind: input.memberReference.accessKind,
      },
    },
  ];
}

function visitRenderNode(
  node: RenderNode,
  inheritedPlacementLocation: SourceAnchor | undefined,
  visitElement: (
    node: RenderElementNode,
    inheritedPlacementLocation: SourceAnchor | undefined,
  ) => void,
): void {
  const placementLocation = node.placementAnchor ?? inheritedPlacementLocation;

  if (node.kind === "element") {
    visitElement(node, inheritedPlacementLocation);
    for (const child of node.children) {
      visitRenderNode(child, placementLocation, visitElement);
    }
    return;
  }

  if (node.kind === "fragment") {
    for (const child of node.children) {
      visitRenderNode(child, placementLocation, visitElement);
    }
    return;
  }

  if (node.kind === "conditional") {
    visitRenderNode(node.whenTrue, placementLocation, visitElement);
    visitRenderNode(node.whenFalse, placementLocation, visitElement);
    return;
  }

  if (node.kind === "repeated-region") {
    visitRenderNode(node.template, placementLocation, visitElement);
  }
}

function buildSelectorQueries(
  selectorQueryResults: SelectorQueryResult[],
  stylesheets: StylesheetAnalysis[],
  indexes: ProjectAnalysisIndexes,
): SelectorQueryAnalysis[] {
  const stylesheetById = new Map(stylesheets.map((stylesheet) => [stylesheet.id, stylesheet]));

  const selectorQueries = selectorQueryResults.map((selectorQueryResult, index) => {
    const stylesheetId =
      selectorQueryResult.source.kind === "css-source" &&
      selectorQueryResult.reachability?.kind === "css-source"
        ? indexes.stylesheetIdByPath.get(
            normalizeProjectPath(selectorQueryResult.reachability.cssFilePath ?? ""),
          )
        : undefined;

    const query: SelectorQueryAnalysis = {
      id: createSelectorQueryId(selectorQueryResult, index),
      stylesheetId,
      selectorText: selectorQueryResult.selectorText,
      location:
        selectorQueryResult.source.kind === "css-source"
          ? selectorQueryResult.source.selectorAnchor
          : undefined,
      constraint: simplifyConstraint(selectorQueryResult),
      outcome: selectorQueryResult.outcome,
      status: selectorQueryResult.status,
      confidence: selectorQueryResult.confidence,
      traces: [...selectorQueryResult.decision.traces],
      sourceResult: selectorQueryResult,
    };

    if (stylesheetId) {
      pushMapValue(indexes.selectorQueriesByStylesheetId, stylesheetId, query.id);
      stylesheetById.get(stylesheetId)?.selectors.push(query.id);
    }

    return query;
  });

  sortIndexValues(indexes.selectorQueriesByStylesheetId);
  return selectorQueries.sort(compareById);
}

function buildSelectorBranches(selectorQueries: SelectorQueryAnalysis[]): SelectorBranchAnalysis[] {
  return selectorQueries
    .filter((query) => query.sourceResult.source.kind === "css-source")
    .flatMap((query, index) => {
      const source = query.sourceResult.source;
      if (source.kind !== "css-source") {
        return [];
      }
      const selectorListText = source.selectorListText ?? query.selectorText;
      const branchIndex = source.branchIndex ?? 0;
      const branchCount = source.branchCount ?? 1;
      const ruleKey = source.ruleKey ?? createSelectorRuleKey(query, index);

      return [
        {
          id: createSelectorBranchId(query, branchIndex, index),
          selectorQueryId: query.id,
          stylesheetId: query.stylesheetId,
          selectorText: query.selectorText,
          selectorListText,
          branchIndex,
          branchCount,
          ruleKey,
          location: query.location,
          constraint: query.constraint,
          outcome: query.outcome,
          status: query.status,
          confidence: query.confidence,
          traces: [...query.traces],
          sourceQuery: query,
        },
      ];
    })
    .sort(compareById);
}

function buildStylesheetReachability(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
): StylesheetReachabilityRelation[] {
  const relations: StylesheetReachabilityRelation[] = [];

  for (const stylesheet of input.reachabilitySummary.stylesheets) {
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
        traces: [...stylesheet.traces],
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
        traces: [...contextRecord.traces],
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

function buildReferenceMatches(input: {
  references: ClassReferenceAnalysis[];
  definitions: ClassDefinitionAnalysis[];
  reachability: StylesheetReachabilityRelation[];
  cssModuleMemberMatches: CssModuleMemberMatchRelation[];
  indexes: ProjectAnalysisIndexes;
}): ClassReferenceMatchRelation[] {
  const reachabilityByStylesheetAndSource = new Map<string, StylesheetReachabilityRelation[]>();
  const reachabilityByStylesheet = new Map<ProjectAnalysisId, StylesheetReachabilityRelation[]>();
  for (const relation of input.reachability) {
    pushMapValue(reachabilityByStylesheet, relation.stylesheetId, relation);

    if (!relation.sourceFileId && !relation.componentId) {
      continue;
    }

    const keys = [
      relation.sourceFileId
        ? createReachabilityContextKey(relation.stylesheetId, "source", relation.sourceFileId)
        : undefined,
      relation.componentId
        ? createReachabilityContextKey(relation.stylesheetId, "component", relation.componentId)
        : undefined,
    ].filter((key): key is string => Boolean(key));

    for (const key of keys) {
      pushMapValue(reachabilityByStylesheetAndSource, key, relation);
    }
  }

  const matches: ClassReferenceMatchRelation[] = [];
  const cssModuleMemberMatchesByReferenceId = new Map(
    input.cssModuleMemberMatches.map((match) => [match.referenceId, match]),
  );

  for (const reference of input.references) {
    if (reference.origin === "css-module-member") {
      const memberReferenceId = reference.sourceCssModuleMemberReferenceId;
      const cssModuleMatch = memberReferenceId
        ? cssModuleMemberMatchesByReferenceId.get(memberReferenceId)
        : undefined;
      if (!cssModuleMatch?.definitionId || cssModuleMatch.status !== "matched") {
        continue;
      }

      matches.push({
        id: `reference-match:${reference.id}:${cssModuleMatch.definitionId}`,
        referenceId: reference.id,
        definitionId: cssModuleMatch.definitionId,
        className: cssModuleMatch.className,
        referenceClassKind: "definite",
        reachability: "definite",
        matchKind: "css-module",
        reasons: [
          `class "${cssModuleMatch.className}" was matched through CSS Module export "${cssModuleMatch.exportName}"`,
        ],
        traces: mergeTraces([...reference.traces, ...cssModuleMatch.traces]),
      });
      continue;
    }

    for (const className of collectReferenceClassNames(reference)) {
      const candidateDefinitionIds = input.indexes.definitionsByClassName.get(className) ?? [];
      for (const definitionId of candidateDefinitionIds) {
        const definition = input.definitions.find((candidate) => candidate.id === definitionId);
        if (!definition) {
          continue;
        }

        const reachability = getBestReachabilityForReference({
          reference,
          stylesheetId: definition.stylesheetId,
          reachabilityByStylesheetAndSource,
          reachabilityByStylesheet,
        });

        matches.push({
          id: `reference-match:${reference.id}:${definition.id}`,
          referenceId: reference.id,
          definitionId: definition.id,
          className,
          referenceClassKind: reference.definiteClassNames.includes(className)
            ? "definite"
            : "possible",
          reachability: reachability.availability,
          matchKind:
            reachability.availability === "definite" ||
            reachability.availability === "possible" ||
            reachability.availability === "unknown"
              ? "reachable-stylesheet"
              : "unreachable-stylesheet",
          reasons:
            reachability.availability === "definite" ||
            reachability.availability === "possible" ||
            reachability.availability === "unknown"
              ? [`class "${className}" is defined in a stylesheet reachable from this reference`]
              : [`class "${className}" is defined, but the defining stylesheet is not reachable`],
          traces: mergeTraces([...reference.traces, ...reachability.traces]),
        });
      }
    }
  }

  return matches.sort(compareById);
}

function buildProviderClassSatisfactions(input: {
  references: ClassReferenceAnalysis[];
  input: ProjectAnalysisBuildInput;
}): ProviderClassSatisfactionRelation[] {
  const relations: ProviderClassSatisfactionRelation[] = [];

  for (const reference of input.references) {
    if (reference.origin === "css-module-member") {
      continue;
    }

    for (const className of collectReferenceClassNames(reference)) {
      for (const provider of input.input.externalCssSummary.activeProviders) {
        const satisfied =
          provider.classNames.includes(className) ||
          provider.classPrefixes.some((classPrefix) => className.startsWith(classPrefix));
        if (!satisfied) {
          continue;
        }

        relations.push({
          id: `provider-class:${reference.id}:${provider.provider}:${className}`,
          referenceId: reference.id,
          className,
          referenceClassKind: reference.definiteClassNames.includes(className)
            ? "definite"
            : "possible",
          provider: provider.provider,
          reasons: [`class "${className}" is declared by active external CSS provider`],
          traces: [...reference.traces],
        });
      }
    }
  }

  return relations.sort(compareById);
}

function buildSelectorMatches(selectorQueries: SelectorQueryAnalysis[]): SelectorMatchRelation[] {
  return selectorQueries
    .filter((selectorQuery) => selectorQuery.sourceResult.reachability?.kind === "css-source")
    .map((selectorQuery) => {
      const reachability =
        selectorQuery.sourceResult.reachability?.kind === "css-source"
          ? selectorQuery.sourceResult.reachability
          : undefined;

      return {
        id: `selector-match:${selectorQuery.id}`,
        selectorQueryId: selectorQuery.id,
        stylesheetId: selectorQuery.stylesheetId,
        availability: reachability?.availability,
        outcome: selectorQuery.outcome,
        contextCount: reachability?.contexts.length ?? 0,
        matchedContextCount: reachability?.matchedContexts?.length ?? 0,
        reasons: reachability?.reasons ?? selectorQuery.sourceResult.reasons,
        traces: mergeTraces([
          ...selectorQuery.traces,
          ...(reachability?.contexts.flatMap((context) => context.traces) ?? []),
          ...(reachability?.matchedContexts?.flatMap((context) => context.traces) ?? []),
        ]),
      };
    })
    .sort(compareById);
}

function buildClassOwnership(input: {
  input: ProjectAnalysisBuildInput;
  definitions: ClassDefinitionAnalysis[];
  references: ClassReferenceAnalysis[];
  components: ComponentAnalysis[];
  stylesheets: StylesheetAnalysis[];
  referenceMatches: ClassReferenceMatchRelation[];
  indexes: ProjectAnalysisIndexes;
}): ClassOwnershipAnalysis[] {
  const referencesById = new Map(input.references.map((reference) => [reference.id, reference]));
  const componentsById = new Map(input.components.map((component) => [component.id, component]));
  const componentsBySourceFileId = new Map<ProjectAnalysisId, ComponentAnalysis[]>();
  for (const component of input.components) {
    const sourceFileId = input.indexes.sourceFileIdByPath.get(component.filePath);
    if (sourceFileId) {
      pushMapValue(componentsBySourceFileId, sourceFileId, component);
    }
  }
  const importerComponentsByStylesheetId = buildImporterComponentsByStylesheetId({
    input: input.input,
    componentsBySourceFileId,
    indexes: input.indexes,
  });

  return input.definitions
    .map((definition) => {
      const stylesheet = input.stylesheets.find(
        (candidate) => candidate.id === definition.stylesheetId,
      );
      const consumerSummary = buildClassConsumerSummary({
        definition,
        referenceMatches: input.referenceMatches,
        referencesById,
      });
      const ownerCandidates = buildOwnerCandidates({
        definition,
        stylesheet,
        consumerSummary,
        componentsById,
        importerComponents: importerComponentsByStylesheetId.get(definition.stylesheetId) ?? [],
      });

      return {
        id: createClassOwnershipId(definition.id),
        classDefinitionId: definition.id,
        stylesheetId: definition.stylesheetId,
        className: definition.className,
        consumerSummary,
        ownerCandidates,
        evidenceKind: getOwnershipEvidenceKind(ownerCandidates, consumerSummary),
        confidence: getOwnershipConfidence(ownerCandidates),
        traces: buildClassOwnershipTraces({
          definition,
          stylesheet,
          consumerSummary,
          ownerCandidates,
        }),
      };
    })
    .sort(compareById);
}

function buildImporterComponentsByStylesheetId(input: {
  input: ProjectAnalysisBuildInput;
  componentsBySourceFileId: Map<ProjectAnalysisId, ComponentAnalysis[]>;
  indexes: ProjectAnalysisIndexes;
}): Map<ProjectAnalysisId, ComponentAnalysis[]> {
  const importerComponentsByStylesheetId = new Map<ProjectAnalysisId, ComponentAnalysis[]>();
  const stylesheetIdByPath = new Map(input.indexes.stylesheetIdByPath);

  for (const moduleNode of input.input.moduleGraph.modulesById.values()) {
    if (moduleNode.kind !== "source") {
      continue;
    }

    const sourceFileId = input.indexes.sourceFileIdByPath.get(
      normalizeProjectPath(moduleNode.filePath),
    );
    if (!sourceFileId) {
      continue;
    }

    for (const importRecord of moduleNode.imports) {
      if (importRecord.importKind !== "css") {
        continue;
      }

      const stylesheetId = resolveStylesheetImportId({
        fromFilePath: moduleNode.filePath,
        specifier: importRecord.specifier,
        stylesheetIdByPath,
      });
      if (!stylesheetId) {
        continue;
      }

      for (const component of input.componentsBySourceFileId.get(sourceFileId) ?? []) {
        pushUniqueMapValue(importerComponentsByStylesheetId, stylesheetId, component);
      }
    }
  }

  for (const components of importerComponentsByStylesheetId.values()) {
    components.sort(compareById);
  }

  return importerComponentsByStylesheetId;
}

function buildClassConsumerSummary(input: {
  definition: ClassDefinitionAnalysis;
  referenceMatches: ClassReferenceMatchRelation[];
  referencesById: Map<ProjectAnalysisId, ClassReferenceAnalysis>;
}): ClassOwnershipAnalysis["consumerSummary"] {
  const matches = input.referenceMatches.filter(
    (match) =>
      match.definitionId === input.definition.id && match.matchKind === "reachable-stylesheet",
  );
  const referenceIds = uniqueSorted(matches.map((match) => match.referenceId));
  const references = referenceIds
    .map((referenceId) => input.referencesById.get(referenceId))
    .filter((reference): reference is ClassReferenceAnalysis => Boolean(reference));

  return {
    classDefinitionId: input.definition.id,
    className: input.definition.className,
    consumerComponentIds: uniqueSorted(
      references
        .map((reference) => reference.componentId)
        .filter((id): id is string => Boolean(id)),
    ),
    consumerSourceFileIds: uniqueSorted(references.map((reference) => reference.sourceFileId)),
    referenceIds,
    matchIds: uniqueSorted(matches.map((match) => match.id)),
  };
}

function resolveStylesheetImportId(input: {
  fromFilePath: string;
  specifier: string;
  stylesheetIdByPath: Map<string, ProjectAnalysisId>;
}): ProjectAnalysisId | undefined {
  if (!input.specifier.startsWith(".")) {
    return undefined;
  }

  const fromSegments = normalizeProjectPath(input.fromFilePath).split("/");
  fromSegments.pop();
  const specifierSegments = input.specifier.split("/").filter(Boolean);
  const candidateBasePath = normalizeSegments([...fromSegments, ...specifierSegments]);
  const candidatePaths = [candidateBasePath, `${candidateBasePath}.css`];

  for (const candidatePath of candidatePaths) {
    const stylesheetId = input.stylesheetIdByPath.get(candidatePath);
    if (stylesheetId) {
      return stylesheetId;
    }
  }

  return undefined;
}

function buildOwnerCandidates(input: {
  definition: ClassDefinitionAnalysis;
  stylesheet: StylesheetAnalysis | undefined;
  consumerSummary: ClassOwnershipAnalysis["consumerSummary"];
  componentsById: Map<ProjectAnalysisId, ComponentAnalysis>;
  importerComponents: ComponentAnalysis[];
}): OwnerCandidate[] {
  const candidates: OwnerCandidate[] = [];

  if (input.importerComponents.length === 1) {
    const component = input.importerComponents[0];
    candidates.push(
      createComponentOwnerCandidate({
        component,
        stylesheet: input.stylesheet,
        reasons: ["single-importing-component"],
        confidence: "high",
        summary: `stylesheet for class "${input.definition.className}" is imported by a single component`,
      }),
    );
  }

  if (input.consumerSummary.consumerComponentIds.length === 1) {
    const component = input.componentsById.get(input.consumerSummary.consumerComponentIds[0]);
    if (component) {
      candidates.push(
        createComponentOwnerCandidate({
          component,
          stylesheet: input.stylesheet,
          reasons: ["single-consuming-component"],
          confidence: "medium",
          summary: `class "${input.definition.className}" is consumed by a single component`,
        }),
      );
    }
  } else if (input.consumerSummary.consumerComponentIds.length > 1) {
    candidates.push({
      kind: "unknown",
      confidence: "low",
      reasons: ["multi-consumer"],
      traces: [
        {
          traceId: `ownership:multi-consumer:${input.definition.id}`,
          category: "rule-evaluation",
          summary: `class "${input.definition.className}" is consumed by multiple components`,
          children: [],
          metadata: {
            classDefinitionId: input.definition.id,
            consumerComponentIds: input.consumerSummary.consumerComponentIds,
          },
        },
      ],
    });
  }

  return mergeOwnerCandidates(candidates);
}

function createComponentOwnerCandidate(input: {
  component: ComponentAnalysis;
  stylesheet: StylesheetAnalysis | undefined;
  reasons: OwnerCandidateReason[];
  confidence: "low" | "medium" | "high";
  summary: string;
}): OwnerCandidate {
  const conventionReasons = getPathConventionReasons({
    componentFilePath: input.component.filePath,
    componentName: input.component.componentName,
    stylesheetFilePath: input.stylesheet?.filePath,
  });
  const reasons = uniqueSorted([...input.reasons, ...conventionReasons]) as OwnerCandidateReason[];

  return {
    kind: "component",
    id: input.component.id,
    path: input.component.filePath,
    confidence: input.confidence,
    reasons,
    traces: [
      {
        traceId: `ownership:component-candidate:${input.component.id}:${stableHash(reasons.join("|"))}`,
        category: "rule-evaluation",
        summary: input.summary,
        anchor: input.component.location,
        children: [],
        metadata: {
          componentId: input.component.id,
          componentName: input.component.componentName,
          componentFilePath: input.component.filePath,
          stylesheetFilePath: input.stylesheet?.filePath,
          reasons,
        },
      },
    ],
  };
}

function mergeOwnerCandidates(candidates: OwnerCandidate[]): OwnerCandidate[] {
  const byKey = new Map<string, OwnerCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.id ?? candidate.path ?? "unknown"}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }

    byKey.set(key, {
      ...existing,
      confidence: maxConfidence(existing.confidence, candidate.confidence),
      reasons: uniqueSorted([...existing.reasons, ...candidate.reasons]) as OwnerCandidateReason[],
      traces: [...existing.traces, ...candidate.traces],
    });
  }

  return [...byKey.values()].sort((left, right) =>
    `${left.kind}:${left.id ?? left.path ?? ""}`.localeCompare(
      `${right.kind}:${right.id ?? right.path ?? ""}`,
    ),
  );
}

function getPathConventionReasons(input: {
  componentFilePath: string;
  componentName: string;
  stylesheetFilePath?: string;
}): OwnerCandidateReason[] {
  if (!input.stylesheetFilePath) {
    return [];
  }

  const componentDir = getDirectoryName(input.componentFilePath);
  const stylesheetDir = getDirectoryName(input.stylesheetFilePath);
  const componentBaseName = getBaseNameWithoutExtension(input.componentFilePath);
  const stylesheetBaseName = getBaseNameWithoutExtension(input.stylesheetFilePath);
  const reasons: OwnerCandidateReason[] = [];

  if (componentDir === stylesheetDir) {
    reasons.push("same-directory");
    if (componentBaseName === stylesheetBaseName) {
      reasons.push("sibling-basename-convention");
    }
    if (
      componentBaseName === "index" &&
      (stylesheetBaseName === input.componentName || stylesheetBaseName === "styles")
    ) {
      reasons.push("component-folder-convention");
    }
  }

  const componentFeatureRoot = getFeatureRoot(input.componentFilePath);
  const stylesheetFeatureRoot = getFeatureRoot(input.stylesheetFilePath);
  if (
    componentFeatureRoot &&
    stylesheetFeatureRoot &&
    componentFeatureRoot === stylesheetFeatureRoot
  ) {
    reasons.push("feature-folder-convention");
  }

  return uniqueSorted(reasons) as OwnerCandidateReason[];
}

function getOwnershipEvidenceKind(
  candidates: OwnerCandidate[],
  consumerSummary: ClassOwnershipAnalysis["consumerSummary"],
): ClassOwnershipAnalysis["evidenceKind"] {
  if (candidates.some((candidate) => candidate.reasons.includes("single-importing-component"))) {
    return "single-importing-component";
  }
  if (candidates.some((candidate) => candidate.reasons.includes("single-consuming-component"))) {
    return "single-consuming-component";
  }
  if (consumerSummary.consumerComponentIds.length > 1) {
    return "multi-consumer";
  }
  if (
    candidates.some((candidate) =>
      candidate.reasons.some((reason) =>
        [
          "same-directory",
          "sibling-basename-convention",
          "component-folder-convention",
          "feature-folder-convention",
        ].includes(reason),
      ),
    )
  ) {
    return "path-convention";
  }
  return "unknown";
}

function getOwnershipConfidence(candidates: OwnerCandidate[]): "low" | "medium" | "high" {
  return candidates.reduce(
    (confidence, candidate) => maxConfidence(confidence, candidate.confidence),
    "low" as "low" | "medium" | "high",
  );
}

function buildClassOwnershipTraces(input: {
  definition: ClassDefinitionAnalysis;
  stylesheet: StylesheetAnalysis | undefined;
  consumerSummary: ClassOwnershipAnalysis["consumerSummary"];
  ownerCandidates: OwnerCandidate[];
}): AnalysisTrace[] {
  return [
    {
      traceId: `ownership:class:${input.definition.id}`,
      category: "rule-evaluation",
      summary: `ownership evidence was collected for class "${input.definition.className}"`,
      anchor: input.stylesheet?.filePath
        ? {
            filePath: input.stylesheet.filePath,
            startLine: input.definition.line,
            startColumn: 1,
          }
        : undefined,
      children: input.ownerCandidates.flatMap((candidate) => candidate.traces),
      metadata: {
        classDefinitionId: input.definition.id,
        className: input.definition.className,
        consumerComponentIds: input.consumerSummary.consumerComponentIds,
        consumerSourceFileIds: input.consumerSummary.consumerSourceFileIds,
      },
    },
  ];
}

function buildCssModuleMemberMatches(input: {
  references: CssModuleMemberReferenceAnalysis[];
  indexes: ProjectAnalysisIndexes;
  localsConvention: ProjectAnalysisBuildInput["cssModules"]["options"]["localsConvention"];
}): CssModuleMemberMatchRelation[] {
  const matches: CssModuleMemberMatchRelation[] = [];

  for (const reference of input.references) {
    const definitionIds = input.indexes.definitionsByStylesheetId.get(reference.stylesheetId) ?? [];
    const definitionId = definitionIds.find((candidateId) => {
      const definition = input.indexes.classDefinitionsById.get(candidateId);
      return (
        definition &&
        getCssModuleExportNames(definition.className, input.localsConvention).includes(
          reference.memberName,
        )
      );
    });

    if (definitionId) {
      const definition = input.indexes.classDefinitionsById.get(definitionId);
      const originalClassName = definition?.className ?? reference.memberName;
      matches.push({
        id: `css-module-member-match:${reference.id}:${definitionId}`,
        referenceId: reference.id,
        importId: reference.importId,
        stylesheetId: reference.stylesheetId,
        definitionId,
        className: originalClassName,
        exportName: reference.memberName,
        status: "matched",
        reasons: [
          `CSS Module member "${reference.memberName}" matched exported class "${originalClassName}"`,
        ],
        traces: mergeTraces(reference.traces),
      });
      continue;
    }

    matches.push({
      id: `css-module-member-match:${reference.id}:missing`,
      referenceId: reference.id,
      importId: reference.importId,
      stylesheetId: reference.stylesheetId,
      className: reference.memberName,
      exportName: reference.memberName,
      status: "missing",
      reasons: [`CSS Module member "${reference.memberName}" has no exported class`],
      traces: mergeTraces(reference.traces),
    });
  }

  return matches.sort(compareById);
}

function getCssModuleExportNames(
  className: string,
  localsConvention: ProjectAnalysisBuildInput["cssModules"]["options"]["localsConvention"],
): string[] {
  const exportNames =
    localsConvention === "asIs"
      ? [className]
      : localsConvention === "camelCaseOnly"
        ? [toCamelCaseClassName(className)]
        : [className, toCamelCaseClassName(className)];

  return uniqueSorted(exportNames);
}

function toCamelCaseClassName(className: string): string {
  return className.replace(/[-_]+([a-zA-Z0-9])/g, (_match, character: string) =>
    character.toUpperCase(),
  );
}

function indexRelations(input: {
  referenceMatches: ClassReferenceMatchRelation[];
  providerClassSatisfactions: ProviderClassSatisfactionRelation[];
  selectorMatches: SelectorMatchRelation[];
  cssModuleMemberMatches: CssModuleMemberMatchRelation[];
  indexes: ProjectAnalysisIndexes;
}): void {
  for (const match of input.referenceMatches) {
    input.indexes.referenceMatchesById.set(match.id, match);
    pushMapValue(input.indexes.matchesByReferenceId, match.referenceId, match.id);
    pushMapValue(
      input.indexes.referenceMatchesByReferenceAndClassName,
      createReferenceClassKey(match.referenceId, match.className),
      match.id,
    );
  }
  for (const satisfaction of input.providerClassSatisfactions) {
    input.indexes.providerSatisfactionsById.set(satisfaction.id, satisfaction);
    pushMapValue(input.indexes.matchesByReferenceId, satisfaction.referenceId, satisfaction.id);
    pushMapValue(
      input.indexes.providerSatisfactionsByReferenceId,
      satisfaction.referenceId,
      satisfaction.id,
    );
    pushMapValue(
      input.indexes.providerSatisfactionsByReferenceAndClassName,
      createReferenceClassKey(satisfaction.referenceId, satisfaction.className),
      satisfaction.id,
    );
  }
  for (const match of input.selectorMatches) {
    input.indexes.selectorMatchesById.set(match.id, match);
    pushMapValue(input.indexes.selectorMatchesByQueryId, match.selectorQueryId, match.id);
  }
  for (const match of input.cssModuleMemberMatches) {
    input.indexes.cssModuleMemberMatchesById.set(match.id, match);
    pushMapValue(input.indexes.cssModuleMemberMatchesByReferenceId, match.referenceId, match.id);
    if (match.definitionId) {
      pushMapValue(
        input.indexes.cssModuleMemberMatchesByDefinitionId,
        match.definitionId,
        match.id,
      );
    }
  }

  sortIndexValues(input.indexes.matchesByReferenceId);
  sortIndexValues(input.indexes.referenceMatchesByReferenceAndClassName);
  sortIndexValues(input.indexes.providerSatisfactionsByReferenceId);
  sortIndexValues(input.indexes.providerSatisfactionsByReferenceAndClassName);
  sortIndexValues(input.indexes.selectorMatchesByQueryId);
  sortIndexValues(input.indexes.cssModuleMemberMatchesByReferenceId);
  sortIndexValues(input.indexes.cssModuleMemberMatchesByDefinitionId);
}

function indexEntities(input: {
  sourceFiles: SourceFileAnalysis[];
  stylesheets: StylesheetAnalysis[];
  classReferences: ClassReferenceAnalysis[];
  classDefinitions: ClassDefinitionAnalysis[];
  selectorQueries: SelectorQueryAnalysis[];
  selectorBranches: SelectorBranchAnalysis[];
  components: ComponentAnalysis[];
  unsupportedClassReferences: UnsupportedClassReferenceAnalysis[];
  cssModuleImports: CssModuleImportAnalysis[];
  cssModuleNamedImportBindings: CssModuleNamedImportBindingAnalysis[];
  cssModuleAliases: CssModuleAliasAnalysis[];
  cssModuleDestructuredBindings: CssModuleDestructuredBindingAnalysis[];
  cssModuleMemberReferences: CssModuleMemberReferenceAnalysis[];
  cssModuleReferenceDiagnostics: CssModuleReferenceDiagnosticAnalysis[];
  indexes: ProjectAnalysisIndexes;
}): void {
  for (const sourceFile of input.sourceFiles) {
    input.indexes.sourceFilesById.set(sourceFile.id, sourceFile);
  }
  for (const stylesheet of input.stylesheets) {
    input.indexes.stylesheetsById.set(stylesheet.id, stylesheet);
  }
  for (const reference of input.classReferences) {
    input.indexes.classReferencesById.set(reference.id, reference);
  }
  for (const definition of input.classDefinitions) {
    input.indexes.classDefinitionsById.set(definition.id, definition);
  }
  for (const selectorQuery of input.selectorQueries) {
    input.indexes.selectorQueriesById.set(selectorQuery.id, selectorQuery);
  }
  for (const selectorBranch of input.selectorBranches) {
    input.indexes.selectorBranchesById.set(selectorBranch.id, selectorBranch);
    pushMapValue(
      input.indexes.selectorBranchesByQueryId,
      selectorBranch.selectorQueryId,
      selectorBranch.id,
    );
    pushMapValue(
      input.indexes.selectorBranchesByRuleKey,
      selectorBranch.ruleKey,
      selectorBranch.id,
    );
    if (selectorBranch.stylesheetId) {
      pushMapValue(
        input.indexes.selectorBranchesByStylesheetId,
        selectorBranch.stylesheetId,
        selectorBranch.id,
      );
    }
  }
  for (const component of input.components) {
    input.indexes.componentsById.set(component.id, component);
  }
  for (const unsupportedReference of input.unsupportedClassReferences) {
    input.indexes.unsupportedClassReferencesById.set(unsupportedReference.id, unsupportedReference);
  }
  for (const cssModuleImport of input.cssModuleImports) {
    input.indexes.cssModuleImportsById.set(cssModuleImport.id, cssModuleImport);
    pushMapValue(
      input.indexes.cssModuleImportsBySourceFileId,
      cssModuleImport.sourceFileId,
      cssModuleImport.id,
    );
    pushMapValue(
      input.indexes.cssModuleImportsByStylesheetId,
      cssModuleImport.stylesheetId,
      cssModuleImport.id,
    );
  }
  for (const binding of input.cssModuleNamedImportBindings) {
    input.indexes.cssModuleNamedImportBindingsById.set(binding.id, binding);
    pushMapValue(
      input.indexes.cssModuleNamedImportBindingsByImportId,
      binding.importId,
      binding.id,
    );
  }
  for (const alias of input.cssModuleAliases) {
    input.indexes.cssModuleAliasesById.set(alias.id, alias);
    pushMapValue(input.indexes.cssModuleAliasesByImportId, alias.importId, alias.id);
  }
  for (const binding of input.cssModuleDestructuredBindings) {
    input.indexes.cssModuleDestructuredBindingsById.set(binding.id, binding);
    pushMapValue(
      input.indexes.cssModuleDestructuredBindingsByImportId,
      binding.importId,
      binding.id,
    );
  }
  for (const reference of input.cssModuleMemberReferences) {
    input.indexes.cssModuleMemberReferencesById.set(reference.id, reference);
    pushMapValue(
      input.indexes.cssModuleMemberReferencesByImportId,
      reference.importId,
      reference.id,
    );
    pushMapValue(
      input.indexes.cssModuleMemberReferencesByStylesheetAndClassName,
      createStylesheetClassKey(reference.stylesheetId, reference.memberName),
      reference.id,
    );
  }
  for (const diagnostic of input.cssModuleReferenceDiagnostics) {
    input.indexes.cssModuleReferenceDiagnosticsById.set(diagnostic.id, diagnostic);
    pushMapValue(
      input.indexes.cssModuleReferenceDiagnosticsByImportId,
      diagnostic.importId,
      diagnostic.id,
    );
  }

  sortIndexValues(input.indexes.cssModuleImportsBySourceFileId);
  sortIndexValues(input.indexes.selectorBranchesByQueryId);
  sortIndexValues(input.indexes.selectorBranchesByRuleKey);
  sortIndexValues(input.indexes.selectorBranchesByStylesheetId);
  sortIndexValues(input.indexes.cssModuleImportsByStylesheetId);
  sortIndexValues(input.indexes.cssModuleNamedImportBindingsByImportId);
  sortIndexValues(input.indexes.cssModuleAliasesByImportId);
  sortIndexValues(input.indexes.cssModuleDestructuredBindingsByImportId);
  sortIndexValues(input.indexes.cssModuleMemberReferencesByImportId);
  sortIndexValues(input.indexes.cssModuleMemberReferencesByStylesheetAndClassName);
  sortIndexValues(input.indexes.cssModuleReferenceDiagnosticsByImportId);
}

function indexClassOwnership(
  ownershipRecords: ClassOwnershipAnalysis[],
  indexes: ProjectAnalysisIndexes,
): void {
  for (const ownership of ownershipRecords) {
    indexes.classOwnershipById.set(ownership.id, ownership);
    indexes.classOwnershipByClassDefinitionId.set(ownership.classDefinitionId, ownership.id);
    pushMapValue(indexes.classOwnershipByStylesheetId, ownership.stylesheetId, ownership.id);

    for (const candidate of ownership.ownerCandidates) {
      if (candidate.kind === "component" && candidate.id) {
        pushMapValue(indexes.classOwnershipByOwnerComponentId, candidate.id, ownership.id);
      }
    }

    for (const consumerComponentId of ownership.consumerSummary.consumerComponentIds) {
      pushMapValue(indexes.classOwnershipByConsumerComponentId, consumerComponentId, ownership.id);
    }
  }

  sortIndexValues(indexes.classOwnershipByStylesheetId);
  sortIndexValues(indexes.classOwnershipByOwnerComponentId);
  sortIndexValues(indexes.classOwnershipByConsumerComponentId);
}

function buildModuleImports(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
): ModuleImportRelation[] {
  const imports: ModuleImportRelation[] = [];

  for (const moduleNode of input.moduleGraph.modulesById.values()) {
    if (moduleNode.kind !== "source") {
      continue;
    }

    const sourceFileId = indexes.sourceFileIdByPath.get(normalizeProjectPath(moduleNode.filePath));
    if (!sourceFileId) {
      continue;
    }

    for (const importRecord of moduleNode.imports) {
      imports.push({
        fromSourceFileId: sourceFileId,
        toModuleId: importRecord.resolvedModuleId,
        specifier: importRecord.specifier,
        importKind: importRecord.importKind,
      });
    }
  }

  return imports.sort((left, right) =>
    `${left.fromSourceFileId}:${left.specifier}:${left.importKind}`.localeCompare(
      `${right.fromSourceFileId}:${right.specifier}:${right.importKind}`,
    ),
  );
}

function buildComponentRenders(
  edges: RenderGraphEdge[],
  indexes: ProjectAnalysisIndexes,
): ComponentRenderRelation[] {
  const relations: ComponentRenderRelation[] = [];

  for (const edge of edges) {
    const fromComponentId = indexes.componentIdByFilePathAndName.get(
      createComponentKey(normalizeProjectPath(edge.fromFilePath), edge.fromComponentName),
    );
    if (!fromComponentId) {
      continue;
    }

    const toComponentId = edge.toFilePath
      ? indexes.componentIdByFilePathAndName.get(
          createComponentKey(normalizeProjectPath(edge.toFilePath), edge.toComponentName),
        )
      : undefined;

    relations.push({
      fromComponentId,
      toComponentId,
      renderPath: edge.renderPath,
      resolution: edge.resolution,
      location: normalizeAnchor(edge.sourceAnchor),
      traces: [...edge.traces],
    });
  }

  return relations.sort((left, right) =>
    `${left.fromComponentId}:${left.toComponentId ?? ""}:${left.location.startLine}`.localeCompare(
      `${right.fromComponentId}:${right.toComponentId ?? ""}:${right.location.startLine}`,
    ),
  );
}

function getStylesheetOrigin(
  filePath: string | undefined,
  input: ProjectAnalysisBuildInput,
): StylesheetOrigin {
  if (!filePath) {
    return "unknown";
  }
  if (isCssModuleStylesheet(filePath)) {
    return "css-module";
  }
  if (isExternalStylesheet(filePath, input)) {
    return "external-import";
  }
  return "project-css";
}

function isExternalStylesheet(filePath: string, input: ProjectAnalysisBuildInput): boolean {
  const normalizedFilePath = normalizeProjectPath(filePath);
  for (const moduleNode of input.moduleGraph.modulesById.values()) {
    if (
      moduleNode.kind === "source" &&
      moduleNode.imports.some(
        (importRecord) =>
          importRecord.importKind === "external-css" &&
          normalizeProjectPath(importRecord.specifier) === normalizedFilePath,
      )
    ) {
      return true;
    }
  }

  return input.externalCssSummary.projectWideStylesheetFilePaths
    .map(normalizeProjectPath)
    .includes(normalizedFilePath);
}

function getDefinitionSelectorKind(
  definition: ClassDefinitionAnalysis["sourceDefinition"],
): ClassDefinitionSelectorKind {
  if (definition.selectorBranch.hasUnknownSemantics) {
    return "unsupported";
  }
  if (
    definition.selectorBranch.matchKind === "standalone" &&
    !definition.selectorBranch.hasSubjectModifiers
  ) {
    return "simple-root";
  }
  if (definition.selectorBranch.matchKind === "compound") {
    return "compound";
  }
  if (definition.selectorBranch.matchKind === "contextual") {
    return "contextual";
  }
  return "complex";
}

function getReferenceExpressionKind(
  classExpression: ClassExpressionSummary,
): ClassReferenceExpressionKind {
  if (classExpression.value.kind === "string-exact") {
    return "exact-string";
  }
  if (classExpression.value.kind === "string-set") {
    return "string-set";
  }
  if (classExpression.classes.unknownDynamic) {
    return "dynamic";
  }
  return "unsupported";
}

function getReferenceConfidence(classExpression: ClassExpressionSummary) {
  if (classExpression.classes.unknownDynamic) {
    return "low";
  }
  if (classExpression.classes.possible.length > 0) {
    return "medium";
  }
  return "high";
}

function collectReferenceClassNames(reference: ClassReferenceAnalysis): string[] {
  return [...new Set([...reference.definiteClassNames, ...reference.possibleClassNames])].sort(
    (left, right) => left.localeCompare(right),
  );
}

function getBestReachabilityForReference(input: {
  reference: ClassReferenceAnalysis;
  stylesheetId: ProjectAnalysisId;
  reachabilityByStylesheetAndSource: Map<string, StylesheetReachabilityRelation[]>;
  reachabilityByStylesheet: Map<ProjectAnalysisId, StylesheetReachabilityRelation[]>;
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

function getReachabilityRelations(input: {
  stylesheetId: ProjectAnalysisId;
  kind: "source" | "component";
  id: ProjectAnalysisId;
  reachabilityByStylesheetAndSource: Map<string, StylesheetReachabilityRelation[]>;
}): StylesheetReachabilityRelation[] {
  return (
    input.reachabilityByStylesheetAndSource.get(
      createReachabilityContextKey(input.stylesheetId, input.kind, input.id),
    ) ?? []
  );
}

function getSourceFileIdForContext(
  contextRecord: StylesheetReachabilityRelation["contexts"][number],
  indexes: ProjectAnalysisIndexes,
): ProjectAnalysisId | undefined {
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

function getComponentIdForContext(
  contextRecord: StylesheetReachabilityRelation["contexts"][number],
  indexes: ProjectAnalysisIndexes,
): ProjectAnalysisId | undefined {
  const context = contextRecord.context;
  if (
    (context.kind === "component" ||
      context.kind === "render-subtree-root" ||
      context.kind === "render-region") &&
    context.componentName
  ) {
    return indexes.componentIdByFilePathAndName.get(
      createComponentKey(normalizeProjectPath(context.filePath), context.componentName),
    );
  }

  return undefined;
}

function simplifyConstraint(
  selectorQueryResult: SelectorQueryResult,
): SelectorQueryAnalysis["constraint"] {
  const constraint = selectorQueryResult.constraint;
  if (!constraint) {
    return undefined;
  }
  if (constraint.kind === "unsupported") {
    return {
      kind: "unsupported",
      reason: constraint.reason,
    };
  }

  return constraint;
}

function getDeclarationSignature(declarations: DeclarationForSignature[]): string {
  return declarations
    .map((declaration) => `${declaration.property}:${declaration.value}`)
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function createEmptyIndexes(): ProjectAnalysisIndexes {
  return {
    sourceFilesById: new Map(),
    stylesheetsById: new Map(),
    classReferencesById: new Map(),
    classDefinitionsById: new Map(),
    selectorQueriesById: new Map(),
    selectorBranchesById: new Map(),
    classOwnershipById: new Map(),
    componentsById: new Map(),
    unsupportedClassReferencesById: new Map(),
    cssModuleImportsById: new Map(),
    cssModuleNamedImportBindingsById: new Map(),
    cssModuleAliasesById: new Map(),
    cssModuleDestructuredBindingsById: new Map(),
    cssModuleMemberReferencesById: new Map(),
    cssModuleReferenceDiagnosticsById: new Map(),
    sourceFileIdByPath: new Map(),
    stylesheetIdByPath: new Map(),
    componentIdByFilePathAndName: new Map(),
    definitionsByClassName: new Map(),
    definitionsByStylesheetId: new Map(),
    referencesByClassName: new Map(),
    referencesBySourceFileId: new Map(),
    reachableStylesheetsBySourceFileId: new Map(),
    reachableStylesheetsByComponentId: new Map(),
    selectorQueriesByStylesheetId: new Map(),
    selectorBranchesByStylesheetId: new Map(),
    selectorBranchesByQueryId: new Map(),
    selectorBranchesByRuleKey: new Map(),
    classOwnershipByClassDefinitionId: new Map(),
    classOwnershipByStylesheetId: new Map(),
    classOwnershipByOwnerComponentId: new Map(),
    classOwnershipByConsumerComponentId: new Map(),
    referenceMatchesById: new Map(),
    matchesByReferenceId: new Map(),
    referenceMatchesByReferenceAndClassName: new Map(),
    providerSatisfactionsById: new Map(),
    providerSatisfactionsByReferenceId: new Map(),
    providerSatisfactionsByReferenceAndClassName: new Map(),
    selectorMatchesById: new Map(),
    selectorMatchesByQueryId: new Map(),
    cssModuleMemberMatchesById: new Map(),
    cssModuleImportsBySourceFileId: new Map(),
    cssModuleImportsByStylesheetId: new Map(),
    cssModuleNamedImportBindingsByImportId: new Map(),
    cssModuleAliasesByImportId: new Map(),
    cssModuleDestructuredBindingsByImportId: new Map(),
    cssModuleMemberReferencesByImportId: new Map(),
    cssModuleMemberReferencesByStylesheetAndClassName: new Map(),
    cssModuleMemberMatchesByReferenceId: new Map(),
    cssModuleMemberMatchesByDefinitionId: new Map(),
    cssModuleReferenceDiagnosticsByImportId: new Map(),
  };
}

function createClassDefinitionId(
  stylesheetId: ProjectAnalysisId,
  definition: ClassDefinitionAnalysis["sourceDefinition"],
): ProjectAnalysisId {
  return [
    "class-definition",
    stylesheetId,
    definition.className,
    definition.line,
    stableHash(
      `${definition.selector}:${definition.atRuleContext
        .map((entry) => `${entry.name}:${entry.params}`)
        .join("|")}`,
    ),
  ].join(":");
}

function createSelectorQueryId(
  selectorQueryResult: SelectorQueryResult,
  index: number,
): ProjectAnalysisId {
  const anchor =
    selectorQueryResult.source.kind === "css-source"
      ? selectorQueryResult.source.selectorAnchor
      : undefined;
  return anchor
    ? createAnchorId("selector-query", anchor, index)
    : `selector-query:direct:${index}:${stableHash(selectorQueryResult.selectorText)}`;
}

function createSelectorBranchId(
  selectorQuery: SelectorQueryAnalysis,
  branchIndex: number,
  index: number,
): ProjectAnalysisId {
  const anchor = selectorQuery.location;
  return anchor
    ? createAnchorId("selector-branch", anchor, branchIndex)
    : `selector-branch:${index}:${stableHash(`${selectorQuery.id}:${branchIndex}`)}`;
}

function createSelectorRuleKey(selectorQuery: SelectorQueryAnalysis, index: number): string {
  return [
    selectorQuery.stylesheetId ?? "direct-query",
    selectorQuery.location?.startLine ?? index,
    selectorQuery.location?.startColumn ?? 0,
    selectorQuery.selectorText,
  ].join(":");
}

function createAnchorId(kind: string, anchor: SourceAnchor, index: number): ProjectAnalysisId {
  const normalizedAnchor = normalizeAnchor(anchor);
  return [
    kind,
    normalizeProjectPath(normalizedAnchor.filePath),
    normalizedAnchor.startLine,
    normalizedAnchor.startColumn,
    index,
  ].join(":");
}

function createPathId(kind: string, filePath: string): ProjectAnalysisId {
  return `${kind}:${normalizeProjectPath(filePath)}`;
}

function createComponentId(filePath: string, componentName: string): ProjectAnalysisId {
  return `component:${filePath}:${componentName}`;
}

function createComponentKey(filePath: string, componentName: string): string {
  return `${filePath}::${componentName}`;
}

function createReachabilityContextKey(
  stylesheetId: ProjectAnalysisId,
  kind: "source" | "component",
  id: ProjectAnalysisId,
): string {
  return `${stylesheetId}:${kind}:${id}`;
}

function createReferenceClassKey(referenceId: ProjectAnalysisId, className: string): string {
  return `${referenceId}:${className}`;
}

function createClassOwnershipId(classDefinitionId: ProjectAnalysisId): string {
  return `class-ownership:${classDefinitionId}`;
}

function createStylesheetClassKey(stylesheetId: ProjectAnalysisId, className: string): string {
  return `${stylesheetId}:${className}`;
}

function createCssModuleImportId(input: {
  sourceFilePath: string;
  stylesheetFilePath: string;
  localName: string;
}): ProjectAnalysisId {
  return [
    "css-module-import",
    normalizeProjectPath(input.sourceFilePath),
    normalizeProjectPath(input.stylesheetFilePath),
    input.localName,
  ].join(":");
}

function createCssModuleMemberReferenceId(
  location: SourceAnchor,
  importId: ProjectAnalysisId,
  memberName: string,
): ProjectAnalysisId {
  return [
    "css-module-member-reference",
    importId,
    memberName,
    location.startLine,
    location.startColumn,
  ].join(":");
}

function createCssModuleNamedImportBindingId(
  location: SourceAnchor,
  importId: ProjectAnalysisId,
  importedName: string,
  localName: string,
): ProjectAnalysisId {
  return [
    "css-module-named-import-binding",
    importId,
    importedName,
    localName,
    location.startLine,
    location.startColumn,
  ].join(":");
}

function createCssModuleAliasId(
  location: SourceAnchor,
  importId: ProjectAnalysisId,
  aliasName: string,
): ProjectAnalysisId {
  return ["css-module-alias", importId, aliasName, location.startLine, location.startColumn].join(
    ":",
  );
}

function createCssModuleDestructuredBindingId(
  location: SourceAnchor,
  importId: ProjectAnalysisId,
  memberName: string,
  bindingName: string,
): ProjectAnalysisId {
  return [
    "css-module-destructured-binding",
    importId,
    memberName,
    bindingName,
    location.startLine,
    location.startColumn,
  ].join(":");
}

function createCssModuleDiagnosticId(
  location: SourceAnchor,
  importId: ProjectAnalysisId,
): ProjectAnalysisId {
  return [
    "css-module-reference-diagnostic",
    importId,
    location.startLine,
    location.startColumn,
  ].join(":");
}

function createCssModuleImportLookupKey(input: {
  sourceFilePath: string;
  stylesheetFilePath: string;
  localName: string;
}): string {
  return [
    normalizeProjectPath(input.sourceFilePath),
    normalizeProjectPath(input.stylesheetFilePath),
    input.localName,
  ].join(":");
}

function isCssModuleStylesheet(filePath: string | undefined): boolean {
  return Boolean(filePath?.match(/\.module\.[cm]?css$/i));
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function normalizeOptionalProjectPath(filePath: string | undefined): string | undefined {
  return filePath ? normalizeProjectPath(filePath) : undefined;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function maxConfidence(
  left: "low" | "medium" | "high",
  right: "low" | "medium" | "high",
): "low" | "medium" | "high" {
  const rank = {
    low: 0,
    medium: 1,
    high: 2,
  };

  return rank[left] >= rank[right] ? left : right;
}

function getDirectoryName(filePath: string): string {
  const normalized = normalizeProjectPath(filePath);
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex === -1 ? "" : normalized.slice(0, separatorIndex);
}

function getBaseNameWithoutExtension(filePath: string): string {
  const normalized = normalizeProjectPath(filePath);
  const baseName = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dotIndex = baseName.indexOf(".");
  return dotIndex === -1 ? baseName : baseName.slice(0, dotIndex);
}

function getFeatureRoot(filePath: string): string | undefined {
  const segments = normalizeProjectPath(filePath).split("/");
  const featureIndex = segments.findIndex((segment) => segment === "features");
  if (featureIndex === -1 || !segments[featureIndex + 1]) {
    return undefined;
  }

  return segments.slice(0, featureIndex + 2).join("/");
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

function normalizeAnchor(anchor: SourceAnchor): SourceAnchor {
  return {
    ...anchor,
    filePath: normalizeProjectPath(anchor.filePath),
  };
}

function normalizeOptionalAnchor(anchor: SourceAnchor | undefined): SourceAnchor | undefined {
  return anchor ? normalizeAnchor(anchor) : undefined;
}

function pushMapValue<TKey, TValue>(map: Map<TKey, TValue[]>, key: TKey, value: TValue): void {
  const existing = map.get(key) ?? [];
  existing.push(value);
  map.set(key, existing);
}

function pushUniqueMapValue<TKey, TValue>(
  map: Map<TKey, TValue[]>,
  key: TKey,
  value: TValue,
): void {
  const existing = map.get(key) ?? [];
  if (!existing.includes(value)) {
    existing.push(value);
  }
  map.set(key, existing);
}

function mergeTraces(traces: AnalysisTrace[]): AnalysisTrace[] {
  const tracesByKey = new Map<string, AnalysisTrace>();
  for (const trace of traces) {
    tracesByKey.set(JSON.stringify(trace), trace);
  }

  return [...tracesByKey.values()].sort((left, right) => left.traceId.localeCompare(right.traceId));
}

function sortIndexValues(map: Map<string, string[]>): void {
  for (const [key, values] of map.entries()) {
    map.set(
      key,
      [...values].sort((left, right) => left.localeCompare(right)),
    );
  }
}

function compareById<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function compareReachabilityRelations(
  left: StylesheetReachabilityRelation,
  right: StylesheetReachabilityRelation,
): number {
  return `${left.stylesheetId}:${left.sourceFileId ?? ""}:${left.componentId ?? ""}:${left.availability}`.localeCompare(
    `${right.stylesheetId}:${right.sourceFileId ?? ""}:${right.componentId ?? ""}:${right.availability}`,
  );
}

function compareAnchors(left: SourceAnchor, right: SourceAnchor): number {
  return (
    normalizeProjectPath(left.filePath).localeCompare(normalizeProjectPath(right.filePath)) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    (left.endLine ?? 0) - (right.endLine ?? 0) ||
    (left.endColumn ?? 0) - (right.endColumn ?? 0)
  );
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
