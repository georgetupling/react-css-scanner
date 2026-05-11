import type { FactGraphResult } from "../fact-graph/index.js";
import type { ProjectEvidenceId } from "../project-evidence/index.js";
import type {
  RenderModel,
  RenderedComponentBoundary,
  RenderedElement,
} from "../render-structure/index.js";
import type {
  SourceExpressionSyntaxFact,
  SourceObjectExpressionProperty,
  SourceObjectLiteralExpressionSyntax,
} from "../language-frontends/source/expression-syntax/index.js";
import type { SourceFrontendFile } from "../language-frontends/index.js";
import {
  getReactInlineStyleDeclarationSemantics,
  type ReactInlineStyleSiteFact,
} from "../language-frontends/source/react-syntax/index.js";
import type { CssDeclarationPropertyEffect } from "../../types/css.js";
import { cascadeDeclarationCandidateId } from "./ids.js";
import { createConditionSetFromRenderedElement, mapRenderCertainty } from "./conditions.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisDiagnosticCode,
  CascadeConditionSet,
  CascadeDeclarationCandidate,
} from "./types.js";
import type { CascadeAnalysisInput } from "./buildCascadeAnalysis.js";

export function buildInlineStyleCandidates(input: {
  input: CascadeAnalysisInput;
  conditionSetsById: Map<string, CascadeConditionSet>;
  includeTraces: boolean;
  diagnostics: CascadeAnalysisDiagnostic[];
  createDiagnostic: (input: {
    code: CascadeAnalysisDiagnosticCode;
    message: string;
    declarationId?: ProjectEvidenceId;
    selectorBranchId?: ProjectEvidenceId;
    elementId?: string;
    location?: CascadeAnalysisDiagnostic["location"];
    traces: CascadeAnalysisDiagnostic["traces"];
  }) => CascadeAnalysisDiagnostic;
}): CascadeDeclarationCandidate[] {
  const candidates: CascadeDeclarationCandidate[] = [];
  const inlineStyleSites = input.input.factGraph.frontends.source.files.flatMap((sourceFile) =>
    sourceFile.reactSyntax.inlineStyleSites.map((site) => ({ sourceFile, site })),
  );
  const componentStyleSuppliesByBoundaryId = buildComponentStyleSuppliesByBoundaryId({
    inlineStyleSites,
    input: input.input,
  });
  const boundaryById = new Map(
    input.input.renderModel.componentBoundaries.map((boundary) => [boundary.id, boundary] as const),
  );
  const inlineStyleResolutionContext = createInlineStyleResolutionContext(input.input.factGraph);
  const inlineOrderById = new Map(
    inlineStyleSites
      .sort(
        (left, right) =>
          left.site.filePath.localeCompare(right.site.filePath) ||
          left.site.location.startLine - right.site.location.startLine ||
          left.site.location.startColumn - right.site.location.startColumn ||
          left.site.siteKey.localeCompare(right.site.siteKey),
      )
      .map(({ site }, index) => [site.siteKey, index] as const),
  );

  for (const { sourceFile, site } of inlineStyleSites) {
    if (site.kind === "component-prop-style") {
      continue;
    }

    const elementIds = findRenderedElementIdsForInlineStyleSite({
      site,
      graph: input.input.factGraph.graph,
      renderModel: input.input.renderModel,
    });
    if (elementIds.length === 0) {
      input.diagnostics.push(
        input.createDiagnostic({
          code: "unsupported-inline-style",
          message: `Inline style "${site.rawExpressionText}" could not be linked to a rendered element.`,
          location: site.location,
          traces: [],
        }),
      );
      continue;
    }

    for (const elementId of elementIds) {
      const renderedElement = input.input.renderModel.indexes.elementById.get(elementId);
      if (!renderedElement) {
        continue;
      }
      const declarations = resolveInlineStyleDeclarationsForElement({
        site,
        sourceFile,
        renderedElement,
        componentStyleSuppliesByBoundaryId,
        boundaryById,
        resolutionContext: inlineStyleResolutionContext,
      });
      if (declarations.unsupportedReason) {
        input.diagnostics.push(
          input.createDiagnostic({
            code: "unsupported-inline-style",
            message: declarations.unsupportedReason,
            elementId,
            location: site.location,
            traces: [],
          }),
        );
        continue;
      }
      const conditionSet = createConditionSetFromRenderedElement({
        renderedElement,
        includeTraces: input.includeTraces,
      });
      input.conditionSetsById.set(conditionSet.id, conditionSet);

      for (const declaration of declarations.declarations) {
        for (const propertyEffect of declaration.propertyEffects) {
          candidates.push({
            id: cascadeDeclarationCandidateId({
              inlineStyleId: site.siteKey,
              elementId,
              property: propertyEffect.property,
            }),
            inlineStyleId: site.siteKey,
            elementId,
            property: propertyEffect.property,
            value: propertyEffect.value,
            declaredProperty: declaration.property,
            declaredValue: declaration.value,
            propertyEffectSource: propertyEffect.source,
            propertyEffectSupported: propertyEffect.supported,
            ...(propertyEffect.reason ? { propertyEffectReason: propertyEffect.reason } : {}),
            ...(propertyEffect.customPropertyDependencies
              ? { customPropertyDependencies: propertyEffect.customPropertyDependencies }
              : {}),
            cascadeKey: {
              origin: "inline",
              important: false,
              layer: {
                known: true,
                unlayered: true,
              },
              specificity: { a: 1, b: 0, c: 0 },
              sourceOrder:
                2_000_000_000 + (inlineOrderById.get(site.siteKey) ?? 0) * 1000 + declaration.order,
              orderKnown: true,
            },
            conditionSetId: conditionSet.id,
            matchCertainty:
              declaration.certainty === "possible"
                ? "possible"
                : mapRenderCertainty(renderedElement.certainty),
            reasons: [
              site.componentPropName
                ? `inline style prop "${site.componentPropName}" is supplied to rendered element`
                : "inline style applies directly to rendered element",
              ...(declaration.certainty === "possible"
                ? ["inline style comes from a conditional style object branch"]
                : []),
              ...(propertyEffect.source === "shorthand"
                ? [`"${declaration.property}" contributes to "${propertyEffect.property}"`]
                : []),
            ],
            traces: input.includeTraces ? renderedElement.traces : [],
          });
        }
      }
    }
  }

  return candidates;
}

type InlineStyleSiteWithSourceFile = {
  sourceFile: CascadeAnalysisInput["factGraph"]["frontends"]["source"]["files"][number];
  site: ReactInlineStyleSiteFact;
};

type InlineStyleDeclaration = {
  property: string;
  value: string;
  propertyEffects: CssDeclarationPropertyEffect[];
  location: ReactInlineStyleSiteFact["location"];
  order: number;
  certainty: "definite" | "possible";
};

type InlineStyleResolutionContext = {
  sourceFileByPath: Map<string, SourceFrontendFile>;
  importedLocalByFileAndName: Map<
    string,
    {
      importedName: string;
      resolvedFilePath: string;
    }
  >;
};

type InlineStyleExpressionAlternative = {
  expression: SourceObjectLiteralExpressionSyntax & SourceExpressionSyntaxFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  certainty: "definite" | "possible";
};

type ComponentStyleSupply = InlineStyleSiteWithSourceFile & {
  boundaryId: string;
  componentPropName: string;
};

function buildComponentStyleSuppliesByBoundaryId(input: {
  inlineStyleSites: InlineStyleSiteWithSourceFile[];
  input: CascadeAnalysisInput;
}): Map<string, ComponentStyleSupply[]> {
  const boundariesByReferenceRenderSiteNodeId = new Map<string, RenderedComponentBoundary[]>();
  for (const boundary of input.input.renderModel.componentBoundaries) {
    if (!boundary.referenceRenderSiteNodeId) {
      continue;
    }
    const existing =
      boundariesByReferenceRenderSiteNodeId.get(boundary.referenceRenderSiteNodeId) ?? [];
    existing.push(boundary);
    boundariesByReferenceRenderSiteNodeId.set(boundary.referenceRenderSiteNodeId, existing);
  }

  const suppliesByBoundaryId = new Map<string, ComponentStyleSupply[]>();
  for (const { sourceFile, site } of input.inlineStyleSites) {
    if (site.kind !== "component-prop-style" || !site.renderSiteKey || !site.componentPropName) {
      continue;
    }
    const renderSiteNodeId =
      input.input.factGraph.graph.indexes.renderSiteNodeIdByRenderSiteKey.get(site.renderSiteKey);
    if (!renderSiteNodeId) {
      continue;
    }
    const boundaries = boundariesByReferenceRenderSiteNodeId.get(renderSiteNodeId) ?? [];
    for (const boundary of boundaries) {
      const supplies = suppliesByBoundaryId.get(boundary.id) ?? [];
      supplies.push({
        sourceFile,
        site,
        boundaryId: boundary.id,
        componentPropName: site.componentPropName,
      });
      suppliesByBoundaryId.set(boundary.id, supplies);
    }
  }

  for (const [boundaryId, supplies] of suppliesByBoundaryId.entries()) {
    suppliesByBoundaryId.set(
      boundaryId,
      supplies.sort(
        (left, right) =>
          left.componentPropName.localeCompare(right.componentPropName) ||
          left.site.siteKey.localeCompare(right.site.siteKey),
      ),
    );
  }
  return suppliesByBoundaryId;
}

function createInlineStyleResolutionContext(
  factGraph: FactGraphResult,
): InlineStyleResolutionContext {
  const sourceFileByPath = new Map(
    factGraph.frontends.source.files.map((sourceFile) => [sourceFile.filePath, sourceFile]),
  );
  const importedLocalByFileAndName = new Map<
    string,
    {
      importedName: string;
      resolvedFilePath: string;
    }
  >();

  for (const edge of factGraph.graph.edges.imports) {
    if (
      edge.importerKind !== "source" ||
      edge.importKind !== "source" ||
      edge.importLoading !== "static" ||
      !edge.resolvedFilePath
    ) {
      continue;
    }

    const sourceFile = sourceFileByPath.get(edge.importerFilePath);
    const frontendImport = sourceFile?.moduleSyntax.imports.find(
      (candidate) =>
        candidate.specifier === edge.specifier &&
        candidate.importKind === edge.importKind &&
        candidate.importLoading === edge.importLoading,
    );
    const frontendImportNames =
      frontendImport?.importNames.map((importName) => ({
        bindingKind: importName.kind,
        importedName: importName.importedName,
        localName: importName.localName,
      })) ?? [];
    const importNames =
      edge.importNames && edge.importNames.length > 0 ? edge.importNames : frontendImportNames;

    for (const importName of importNames) {
      if (importName.bindingKind === "namespace") {
        continue;
      }
      importedLocalByFileAndName.set(`${edge.importerFilePath}::${importName.localName}`, {
        importedName: importName.importedName,
        resolvedFilePath: edge.resolvedFilePath,
      });
    }
  }

  return {
    sourceFileByPath,
    importedLocalByFileAndName,
  };
}

function findRenderedElementIdsForInlineStyleSite(input: {
  site: ReactInlineStyleSiteFact;
  graph: CascadeAnalysisInput["factGraph"]["graph"];
  renderModel: RenderModel;
}): string[] {
  if (input.site.elementTemplateKey) {
    const templateNodeId = input.graph.indexes.elementTemplateNodeIdByTemplateKey.get(
      input.site.elementTemplateKey,
    );
    if (templateNodeId) {
      const elementIds = input.renderModel.indexes.elementIdsByTemplateNodeId.get(templateNodeId);
      if (elementIds && elementIds.length > 0) {
        return [...elementIds].sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (input.site.renderSiteKey) {
    const renderSiteNodeId = input.graph.indexes.renderSiteNodeIdByRenderSiteKey.get(
      input.site.renderSiteKey,
    );
    if (renderSiteNodeId) {
      return [
        ...(input.renderModel.indexes.elementIdsByRenderSiteNodeId.get(renderSiteNodeId) ?? []),
      ].sort((left, right) => left.localeCompare(right));
    }
  }

  return [];
}

function resolveInlineStyleDeclarationsForElement(input: {
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  renderedElement: RenderedElement;
  componentStyleSuppliesByBoundaryId: Map<string, ComponentStyleSupply[]>;
  boundaryById: Map<string, RenderedComponentBoundary>;
  resolutionContext: InlineStyleResolutionContext;
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  if (input.site.componentPropName) {
    const supplied = resolveComponentStyleDeclarations({
      boundaryId: input.renderedElement.parentBoundaryId,
      propName: input.site.componentPropName,
      componentStyleSuppliesByBoundaryId: input.componentStyleSuppliesByBoundaryId,
      boundaryById: input.boundaryById,
      resolutionContext: input.resolutionContext,
      seen: new Set(),
    });
    if (supplied.declarations.length > 0 || supplied.unsupportedReason) {
      return supplied;
    }
  }

  return extractInlineStyleDeclarations({
    site: input.site,
    sourceFile: input.sourceFile,
    resolutionContext: input.resolutionContext,
    expressionById: expressionSyntaxById(input.sourceFile),
  });
}

function resolveComponentStyleDeclarations(input: {
  boundaryId: string;
  propName: string;
  componentStyleSuppliesByBoundaryId: Map<string, ComponentStyleSupply[]>;
  boundaryById: Map<string, RenderedComponentBoundary>;
  resolutionContext: InlineStyleResolutionContext;
  seen: Set<string>;
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  const key = `${input.boundaryId}:${input.propName}`;
  if (input.seen.has(key)) {
    return {
      declarations: [],
      unsupportedReason: `Inline style prop "${input.propName}" forwarding cycle could not be analyzed.`,
    };
  }
  const seen = new Set(input.seen);
  seen.add(key);

  const supply = (input.componentStyleSuppliesByBoundaryId.get(input.boundaryId) ?? []).find(
    (candidate) => candidate.componentPropName === input.propName,
  );
  if (!supply) {
    return {
      declarations: [],
      unsupportedReason: `Inline style prop "${input.propName}" could not be linked to a component style supply.`,
    };
  }

  const direct = extractInlineStyleDeclarations({
    site: supply.site,
    sourceFile: supply.sourceFile,
    resolutionContext: input.resolutionContext,
    expressionById: expressionSyntaxById(supply.sourceFile),
  });
  if (!direct.unsupportedReason) {
    return direct;
  }

  const parentBoundaryId = input.boundaryById.get(input.boundaryId)?.parentBoundaryId;
  if (parentBoundaryId && supply.site.sourceComponentPropName) {
    return resolveComponentStyleDeclarations({
      boundaryId: parentBoundaryId,
      propName: supply.site.sourceComponentPropName,
      componentStyleSuppliesByBoundaryId: input.componentStyleSuppliesByBoundaryId,
      boundaryById: input.boundaryById,
      resolutionContext: input.resolutionContext,
      seen,
    });
  }

  return direct;
}

function expressionSyntaxById(
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"],
): Map<string, SourceExpressionSyntaxFact> {
  return new Map(
    sourceFile.expressionSyntax.map((expression) => [expression.expressionId, expression]),
  );
}

function extractInlineStyleDeclarations(input: {
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  resolutionContext: InlineStyleResolutionContext;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  const rootAlternatives = resolveInlineStyleObjectAlternatives({
    expressionId: input.site.expressionId,
    site: input.site,
    sourceFile: input.sourceFile,
    expressionById: input.expressionById,
    resolutionContext: input.resolutionContext,
    seenExpressionIds: new Set(),
  });
  if (!rootAlternatives || rootAlternatives.length === 0) {
    return {
      declarations: [],
      unsupportedReason: `Inline style "${input.site.rawExpressionText}" is not a statically analyzable object literal.`,
    };
  }

  const branchDeclarations: InlineStyleDeclaration[][] = [];
  for (const alternative of rootAlternatives) {
    const flattened = flattenInlineStyleObject({
      objectExpression: alternative.expression,
      inheritedCertainty: alternative.certainty,
      site: input.site,
      sourceFile: alternative.sourceFile,
      expressionById: alternative.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds: new Set([alternative.expression.expressionId]),
      orderCounter: { value: 0 },
    });
    if (flattened.unsupportedReason) {
      return flattened;
    }
    branchDeclarations.push(collapseInlineDeclarations(flattened.declarations));
  }

  const merged = mergeInlineStyleAlternatives({
    site: input.site,
    alternatives: branchDeclarations,
  });
  if (merged.unsupportedReason) {
    return merged;
  }
  return merged;
}

function flattenInlineStyleObject(input: {
  objectExpression: SourceObjectLiteralExpressionSyntax & SourceExpressionSyntaxFact;
  inheritedCertainty: "definite" | "possible";
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
  orderCounter: { value: number };
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  if (input.objectExpression.hasUnsupportedProperty) {
    return {
      declarations: [],
      unsupportedReason: `Inline style "${input.site.rawExpressionText}" contains unsupported object properties.`,
    };
  }

  const declarations: InlineStyleDeclaration[] = [];
  for (const property of input.objectExpression.properties) {
    if (property.propertyKind === "spread") {
      const spreadObject = resolveInlineStyleSpreadObject({
        property,
        site: input.site,
        sourceFile: input.sourceFile,
        expressionById: input.expressionById,
        resolutionContext: input.resolutionContext,
      });
      if (!spreadObject) {
        return {
          declarations: [],
          unsupportedReason: `Inline style "${input.site.rawExpressionText}" contains spread that could not be statically resolved.`,
        };
      }
      if (input.seenExpressionIds.has(spreadObject.expression.expressionId)) {
        return {
          declarations: [],
          unsupportedReason: `Inline style "${input.site.rawExpressionText}" contains cyclic object spread.`,
        };
      }

      const seenExpressionIds = new Set(input.seenExpressionIds);
      seenExpressionIds.add(spreadObject.expression.expressionId);
      const spread = flattenInlineStyleObject({
        objectExpression: spreadObject.expression,
        inheritedCertainty: input.inheritedCertainty,
        site: input.site,
        sourceFile: spreadObject.sourceFile,
        expressionById: spreadObject.expressionById,
        resolutionContext: input.resolutionContext,
        seenExpressionIds,
        orderCounter: input.orderCounter,
      });
      if (spread.unsupportedReason) {
        return spread;
      }
      declarations.push(...spread.declarations);
      continue;
    }

    const declaration = extractInlineStyleDeclaration({
      property,
      expressionById: input.expressionById,
      fallbackLocation: input.site.location,
      order: input.orderCounter.value,
      certainty: input.inheritedCertainty,
    });
    input.orderCounter.value += 1;
    if (declaration) {
      declarations.push(declaration);
    }
  }

  return {
    declarations,
  };
}

function collapseInlineDeclarations(
  declarations: InlineStyleDeclaration[],
): InlineStyleDeclaration[] {
  const declarationsByProperty = new Map<string, InlineStyleDeclaration>();
  for (const declaration of declarations) {
    declarationsByProperty.set(declaration.property, declaration);
  }
  return [...declarationsByProperty.values()].sort((left, right) => left.order - right.order);
}

function mergeInlineStyleAlternatives(input: {
  site: ReactInlineStyleSiteFact;
  alternatives: InlineStyleDeclaration[][];
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  if (input.alternatives.length === 1) {
    return {
      declarations: input.alternatives[0],
    };
  }

  const declarationsByProperty = new Map<string, InlineStyleDeclaration[]>();
  for (const declarations of input.alternatives) {
    for (const declaration of declarations) {
      declarationsByProperty.set(declaration.property, [
        ...(declarationsByProperty.get(declaration.property) ?? []),
        declaration,
      ]);
    }
  }

  const merged: InlineStyleDeclaration[] = [];
  for (const [property, declarations] of declarationsByProperty.entries()) {
    const uniqueValues = new Set(declarations.map((declaration) => declaration.value));
    if (uniqueValues.size > 1) {
      return {
        declarations: [],
        unsupportedReason: `Inline style "${input.site.rawExpressionText}" has conditional branches with conflicting "${property}" values.`,
      };
    }
    const first = declarations.sort((left, right) => left.order - right.order)[0];
    merged.push({
      ...first,
      certainty: declarations.length === input.alternatives.length ? "definite" : "possible",
    });
  }

  return {
    declarations: merged.sort((left, right) => left.order - right.order),
  };
}

function resolveInlineStyleObjectAlternatives(input: {
  expressionId: string;
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
}): InlineStyleExpressionAlternative[] | undefined {
  if (input.seenExpressionIds.has(input.expressionId)) {
    return undefined;
  }
  const seenExpressionIds = new Set(input.seenExpressionIds);
  seenExpressionIds.add(input.expressionId);

  const expression = unwrapExpressionSyntax(
    input.expressionById.get(input.expressionId),
    input.expressionById,
  );
  if (!expression) {
    return undefined;
  }
  if (expression.expressionKind === "object-literal") {
    return [
      {
        expression,
        sourceFile: input.sourceFile,
        expressionById: input.expressionById,
        certainty: "definite",
      },
    ];
  }
  if (expression.expressionKind === "conditional") {
    const whenTrue = resolveInlineStyleObjectAlternatives({
      ...input,
      expressionId: expression.whenTrueExpressionId,
      seenExpressionIds,
    });
    const whenFalse = resolveInlineStyleObjectAlternatives({
      ...input,
      expressionId: expression.whenFalseExpressionId,
      seenExpressionIds,
    });
    if (!whenTrue || !whenFalse) {
      return undefined;
    }
    return [...whenTrue, ...whenFalse].map((alternative) => ({
      ...alternative,
      certainty: "possible" as const,
    }));
  }
  if (expression.expressionKind === "identifier") {
    return resolveInlineStyleIdentifier({
      identifierName: expression.name,
      site: input.site,
      sourceFile: input.sourceFile,
      expressionById: input.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds,
    });
  }
  if (expression.expressionKind === "call" && expression.argumentExpressionIds.length === 0) {
    const callee = unwrapExpressionSyntax(
      input.expressionById.get(expression.calleeExpressionId),
      input.expressionById,
    );
    if (callee?.expressionKind !== "identifier") {
      return undefined;
    }
    const helper = input.sourceFile.reactSyntax.helperDefinitions
      .filter(
        (candidate) =>
          candidate.helperName === callee.name &&
          candidate.filePath === input.site.filePath &&
          candidate.parameters.length === 0 &&
          !candidate.unsupportedReason &&
          isLocationAtOrBefore(candidate.location, input.site.location),
      )
      .sort(
        (left, right) =>
          right.location.startLine - left.location.startLine ||
          right.location.startColumn - left.location.startColumn ||
          right.helperKey.localeCompare(left.helperKey),
      )
      .at(0);
    const returnExpressionIds =
      helper?.returnExpressionIds ??
      (helper?.returnExpressionId ? [helper.returnExpressionId] : []);
    if (returnExpressionIds.length === 0) {
      return undefined;
    }
    const alternatives = returnExpressionIds.flatMap(
      (returnExpressionId): InlineStyleExpressionAlternative[] =>
        resolveInlineStyleObjectAlternatives({
          ...input,
          expressionId: returnExpressionId,
          seenExpressionIds,
        }) ?? [],
    );
    return alternatives.length > 0
      ? alternatives.map((alternative) => ({
          ...alternative,
          certainty: returnExpressionIds.length > 1 ? "possible" : alternative.certainty,
        }))
      : undefined;
  }

  return undefined;
}

function resolveInlineStyleIdentifier(input: {
  identifierName: string;
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
}): InlineStyleExpressionAlternative[] | undefined {
  const binding = [...input.sourceFile.reactSyntax.localValueBindings]
    .filter(
      (candidate) =>
        candidate.bindingKind === "const-identifier" &&
        candidate.localName === input.identifierName &&
        candidate.location.filePath === input.site.location.filePath &&
        isLocationAtOrBefore(candidate.location, input.site.location) &&
        (!candidate.assignments || candidate.assignments.length === 0),
    )
    .sort(
      (left, right) =>
        right.location.startLine - left.location.startLine ||
        right.location.startColumn - left.location.startColumn ||
        right.bindingKey.localeCompare(left.bindingKey),
    )
    .at(0);
  const objectExpressionId =
    binding?.expressionId ?? binding?.objectExpressionId ?? binding?.initializerExpressionId;
  if (objectExpressionId) {
    return resolveInlineStyleObjectAlternatives({
      expressionId: objectExpressionId,
      site: input.site,
      sourceFile: input.sourceFile,
      expressionById: input.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds: input.seenExpressionIds,
    });
  }

  const imported = input.resolutionContext.importedLocalByFileAndName.get(
    `${input.sourceFile.filePath}::${input.identifierName}`,
  );
  if (!imported) {
    return undefined;
  }
  const importedSourceFile = input.resolutionContext.sourceFileByPath.get(
    imported.resolvedFilePath,
  );
  if (!importedSourceFile) {
    return undefined;
  }
  const importedLocalName =
    imported.importedName === "default"
      ? importedSourceFile.moduleSyntax.declarations.exportedLocalNames.get("default")
      : importedSourceFile.moduleSyntax.declarations.exportedLocalNames.get(imported.importedName);
  if (!importedLocalName) {
    return undefined;
  }
  const importedExpressionById = expressionSyntaxById(importedSourceFile);
  const importedBinding = importedSourceFile.reactSyntax.localValueBindings.find(
    (candidate) =>
      candidate.bindingKind === "const-identifier" &&
      candidate.localName === importedLocalName &&
      (!candidate.assignments || candidate.assignments.length === 0),
  );
  const importedExpressionId =
    importedBinding?.expressionId ??
    importedBinding?.objectExpressionId ??
    importedBinding?.initializerExpressionId;
  if (!importedExpressionId) {
    return undefined;
  }

  return resolveInlineStyleObjectAlternatives({
    expressionId: importedExpressionId,
    site: input.site,
    sourceFile: importedSourceFile,
    expressionById: importedExpressionById,
    resolutionContext: input.resolutionContext,
    seenExpressionIds: input.seenExpressionIds,
  });
}

function resolveInlineStyleSpreadObject(input: {
  property: SourceObjectExpressionProperty;
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
}): InlineStyleExpressionAlternative | undefined {
  if (!input.property.spreadExpressionId) {
    return undefined;
  }

  const alternatives = resolveInlineStyleObjectAlternatives({
    expressionId: input.property.spreadExpressionId,
    site: input.site,
    sourceFile: input.sourceFile,
    expressionById: input.expressionById,
    resolutionContext: input.resolutionContext,
    seenExpressionIds: new Set(),
  });
  return alternatives?.length === 1 && alternatives[0].certainty === "definite"
    ? alternatives[0]
    : undefined;
}

function extractInlineStyleDeclaration(input: {
  property: SourceObjectExpressionProperty;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  fallbackLocation: ReactInlineStyleSiteFact["location"];
  order: number;
  certainty: "definite" | "possible";
}): InlineStyleDeclaration | undefined {
  if (
    input.property.propertyKind !== "property" ||
    input.property.keyKind === "computed" ||
    !input.property.keyText ||
    !input.property.valueExpressionId
  ) {
    return undefined;
  }

  const valueExpression = unwrapExpressionSyntax(
    input.expressionById.get(input.property.valueExpressionId),
    input.expressionById,
  );
  const semantics = getReactInlineStyleDeclarationSemantics({
    propertyName: input.property.keyText,
    valueExpression,
    expressionById: input.expressionById,
  });
  if (!semantics) {
    return undefined;
  }

  return {
    property: semantics.property,
    value: semantics.value,
    propertyEffects: semantics.propertyEffects,
    location: input.property.location ?? input.fallbackLocation,
    order: input.order,
    certainty: input.certainty,
  };
}

function isLocationAtOrBefore(
  left: ReactInlineStyleSiteFact["location"],
  right: ReactInlineStyleSiteFact["location"],
): boolean {
  if (left.filePath !== right.filePath) {
    return false;
  }
  return (
    left.startLine < right.startLine ||
    (left.startLine === right.startLine && left.startColumn <= right.startColumn)
  );
}

function unwrapExpressionSyntax(
  expression: SourceExpressionSyntaxFact | undefined,
  expressionById: Map<string, SourceExpressionSyntaxFact>,
): SourceExpressionSyntaxFact | undefined {
  let current = expression;
  const seen = new Set<string>();
  while (current?.expressionKind === "wrapper" && !seen.has(current.expressionId)) {
    seen.add(current.expressionId);
    current = expressionById.get(current.innerExpressionId);
  }
  return current;
}
