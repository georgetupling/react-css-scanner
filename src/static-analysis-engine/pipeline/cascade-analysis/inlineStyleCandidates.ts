import type { ProjectEvidenceId } from "../project-evidence/index.js";
import type {
  RenderModel,
  RenderedComponentBoundary,
  RenderedElement,
} from "../render-structure/index.js";
import {
  getReactInlineStyleDeclarationSemantics,
  type ReactInlineStyleSiteFact,
} from "../language-frontends/source/react-syntax/index.js";
import type { SourceExpressionSyntaxFact } from "../language-frontends/source/expression-syntax/index.js";
import type {
  StaticInlineStyleObjectFact,
  StaticInlineStyleObjectProperty,
} from "../symbolic-evaluation/index.js";
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
import type { RuntimeStylesheetOrder } from "./runtimeStylesheetOrder.js";

export function buildInlineStyleCandidates(input: {
  input: CascadeAnalysisInput;
  runtimeStylesheetOrder: RuntimeStylesheetOrder;
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
  const expressionByIdByFilePath = buildExpressionByIdByFilePath(input.input);
  const staticInlineStyleObjectBySiteKey =
    input.input.symbolicEvaluation.evaluatedExpressions.indexes.inlineStyleObjectBySiteKey;
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

  for (const { site } of inlineStyleSites) {
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
        renderedElement,
        componentStyleSuppliesByBoundaryId,
        boundaryById,
        expressionByIdByFilePath,
        staticInlineStyleObjectBySiteKey,
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
      const runtimeContextIds = getRuntimeContextIdsForInlineElement({
        renderedElement,
        runtimeStylesheetOrder: input.runtimeStylesheetOrder,
      });

      for (const runtimeContextId of runtimeContextIds) {
        const conditionSet = createConditionSetFromRenderedElement({
          renderedElement,
          ...(runtimeContextId ? { runtimeContextIds: [runtimeContextId] } : {}),
          includeTraces: input.includeTraces,
        });
        input.conditionSetsById.set(conditionSet.id, conditionSet);

        for (const declaration of declarations.declarations) {
          for (const propertyEffect of declaration.propertyEffects) {
            candidates.push({
              id: cascadeDeclarationCandidateId({
                inlineStyleId: site.siteKey,
                elementId,
                ...(runtimeContextId ? { runtimeContextId } : {}),
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
                  2_000_000_000 +
                  (inlineOrderById.get(site.siteKey) ?? 0) * 1000 +
                  declaration.order,
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
                ...(runtimeContextId
                  ? [`inline style applies in runtime CSS context "${runtimeContextId}"`]
                  : []),
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
  }

  return candidates;
}

function getRuntimeContextIdsForInlineElement(input: {
  renderedElement: RenderedElement;
  runtimeStylesheetOrder: RuntimeStylesheetOrder;
}): Array<string | undefined> {
  const sourceFilePath = input.renderedElement.sourceLocation.filePath.replace(/\\/g, "/");
  const runtimeContextIds =
    input.runtimeStylesheetOrder.contextIdsBySourceFilePath.get(sourceFilePath) ?? [];
  const lazyRuntimeContextIds = runtimeContextIds.filter(
    (runtimeContextId) =>
      input.runtimeStylesheetOrder.contextById.get(runtimeContextId)?.loading === "lazy",
  );
  return lazyRuntimeContextIds.length > 0 ? lazyRuntimeContextIds : [undefined];
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

function buildExpressionByIdByFilePath(
  input: CascadeAnalysisInput,
): Map<string, Map<string, SourceExpressionSyntaxFact>> {
  return new Map(
    input.factGraph.frontends.source.files.map((sourceFile) => [
      sourceFile.filePath,
      new Map(
        sourceFile.expressionSyntax.map((expression) => [expression.expressionId, expression]),
      ),
    ]),
  );
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
  renderedElement: RenderedElement;
  componentStyleSuppliesByBoundaryId: Map<string, ComponentStyleSupply[]>;
  boundaryById: Map<string, RenderedComponentBoundary>;
  expressionByIdByFilePath: Map<string, Map<string, SourceExpressionSyntaxFact>>;
  staticInlineStyleObjectBySiteKey: Map<string, StaticInlineStyleObjectFact>;
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
      expressionByIdByFilePath: input.expressionByIdByFilePath,
      staticInlineStyleObjectBySiteKey: input.staticInlineStyleObjectBySiteKey,
      seen: new Set(),
    });
    if (supplied.declarations.length > 0 || supplied.unsupportedReason) {
      return supplied;
    }
  }

  return extractInlineStyleDeclarations({
    site: input.site,
    inlineStyleObject: input.staticInlineStyleObjectBySiteKey.get(input.site.siteKey),
    expressionByIdByFilePath: input.expressionByIdByFilePath,
  });
}

function resolveComponentStyleDeclarations(input: {
  boundaryId: string;
  propName: string;
  componentStyleSuppliesByBoundaryId: Map<string, ComponentStyleSupply[]>;
  boundaryById: Map<string, RenderedComponentBoundary>;
  expressionByIdByFilePath: Map<string, Map<string, SourceExpressionSyntaxFact>>;
  staticInlineStyleObjectBySiteKey: Map<string, StaticInlineStyleObjectFact>;
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
    inlineStyleObject: input.staticInlineStyleObjectBySiteKey.get(supply.site.siteKey),
    expressionByIdByFilePath: input.expressionByIdByFilePath,
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
      expressionByIdByFilePath: input.expressionByIdByFilePath,
      staticInlineStyleObjectBySiteKey: input.staticInlineStyleObjectBySiteKey,
      seen,
    });
  }

  return direct;
}

function extractInlineStyleDeclarations(input: {
  site: ReactInlineStyleSiteFact;
  inlineStyleObject?: StaticInlineStyleObjectFact;
  expressionByIdByFilePath: Map<string, Map<string, SourceExpressionSyntaxFact>>;
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  if (!input.inlineStyleObject || input.inlineStyleObject.unsupportedReason) {
    return {
      declarations: [],
      unsupportedReason:
        input.inlineStyleObject?.unsupportedReason ??
        `Inline style "${input.site.rawExpressionText}" is not a statically analyzable object literal.`,
    };
  }

  const branchDeclarations = input.inlineStyleObject.alternatives.map((alternative) =>
    alternative.properties.flatMap((property) => {
      const declaration = extractInlineStyleDeclaration({
        property,
        expressionById: input.expressionByIdByFilePath.get(property.sourceFilePath) ?? new Map(),
        fallbackLocation: input.site.location,
        certainty: alternative.certainty,
      });
      return declaration ? [declaration] : [];
    }),
  );

  const merged = mergeInlineStyleAlternatives({
    site: input.site,
    alternatives: branchDeclarations,
  });
  if (merged.unsupportedReason) {
    return merged;
  }
  return merged;
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

function extractInlineStyleDeclaration(input: {
  property: StaticInlineStyleObjectProperty;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  fallbackLocation: ReactInlineStyleSiteFact["location"];
  certainty: "definite" | "possible";
}): InlineStyleDeclaration | undefined {
  const semantics = getReactInlineStyleDeclarationSemantics({
    propertyName: input.property.propertyName,
    valueExpression:
      input.property.valueExpression ??
      unwrapExpressionSyntax(
        input.expressionById.get(input.property.valueExpressionId),
        input.expressionById,
      ),
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
    order: input.property.order,
    certainty: input.certainty,
  };
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
