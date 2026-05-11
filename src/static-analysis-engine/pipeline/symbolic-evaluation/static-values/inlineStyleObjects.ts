import type {
  SourceExpressionSyntaxFact,
  SourceObjectExpressionProperty,
  SourceObjectLiteralExpressionSyntax,
} from "../../language-frontends/source/expression-syntax/index.js";
import type { SourceFrontendFile } from "../../language-frontends/index.js";
import type { ReactInlineStyleSiteFact } from "../../language-frontends/source/react-syntax/index.js";
import type { FactGraphResult } from "../../fact-graph/index.js";
import type {
  StaticInlineStyleObjectAlternative,
  StaticInlineStyleObjectFact,
  StaticInlineStyleObjectProperty,
} from "../model/types.js";

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
  sourceFile: SourceFrontendFile;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  certainty: "definite" | "possible";
};

export function evaluateStaticInlineStyleObjects(input: {
  factGraph?: FactGraphResult;
}): StaticInlineStyleObjectFact[] {
  if (!input.factGraph) {
    return [];
  }

  const resolutionContext = createInlineStyleResolutionContext(input.factGraph);
  const inlineStyleSites = input.factGraph.frontends.source.files.flatMap((sourceFile) =>
    sourceFile.reactSyntax.inlineStyleSites.map((site) => ({ sourceFile, site })),
  );

  return inlineStyleSites
    .map(({ sourceFile, site }) =>
      evaluateStaticInlineStyleObject({
        site,
        sourceFile,
        resolutionContext,
        expressionById: expressionSyntaxById(sourceFile),
      }),
    )
    .sort((left, right) => left.siteKey.localeCompare(right.siteKey));
}

function evaluateStaticInlineStyleObject(input: {
  site: ReactInlineStyleSiteFact;
  sourceFile: SourceFrontendFile;
  resolutionContext: InlineStyleResolutionContext;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
}): StaticInlineStyleObjectFact {
  const rootAlternatives = input.site.valueProjection
    ? resolveProjectedInlineStyleObjectAlternatives({
        expressionId: input.site.expressionId,
        site: input.site,
        sourceFile: input.sourceFile,
        expressionById: input.expressionById,
        resolutionContext: input.resolutionContext,
        seenExpressionIds: new Set(),
      })
    : resolveInlineStyleObjectAlternatives({
        expressionId: input.site.expressionId,
        site: input.site,
        sourceFile: input.sourceFile,
        expressionById: input.expressionById,
        resolutionContext: input.resolutionContext,
        seenExpressionIds: new Set(),
      });

  if (!rootAlternatives || rootAlternatives.length === 0) {
    return {
      siteKey: input.site.siteKey,
      filePath: input.site.filePath,
      expressionId: input.site.expressionId,
      rawExpressionText: input.site.rawExpressionText,
      alternatives: [],
      unsupportedReason: `Inline style "${input.site.rawExpressionText}" is not a statically analyzable object literal.`,
    };
  }

  const alternatives: StaticInlineStyleObjectAlternative[] = [];
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
      return {
        siteKey: input.site.siteKey,
        filePath: input.site.filePath,
        expressionId: input.site.expressionId,
        rawExpressionText: input.site.rawExpressionText,
        alternatives: [],
        unsupportedReason: flattened.unsupportedReason,
      };
    }

    alternatives.push({
      certainty: alternative.certainty,
      properties: collapseInlineProperties(flattened.properties),
    });
  }

  return {
    siteKey: input.site.siteKey,
    filePath: input.site.filePath,
    expressionId: input.site.expressionId,
    rawExpressionText: input.site.rawExpressionText,
    alternatives,
  };
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

function expressionSyntaxById(
  sourceFile: SourceFrontendFile,
): Map<string, SourceExpressionSyntaxFact> {
  return new Map(
    sourceFile.expressionSyntax.map((expression) => [expression.expressionId, expression]),
  );
}

function resolveProjectedInlineStyleObjectAlternatives(input: {
  expressionId: string;
  site: ReactInlineStyleSiteFact;
  sourceFile: SourceFrontendFile;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
}): InlineStyleExpressionAlternative[] | undefined {
  const projection = input.site.valueProjection;
  if (!projection || projection.kind !== "object-property") {
    return resolveInlineStyleObjectAlternatives(input);
  }

  const objectAlternatives = resolveInlineStyleObjectAlternatives(input);
  if (!objectAlternatives || objectAlternatives.length === 0) {
    return undefined;
  }

  const projectedAlternatives: InlineStyleExpressionAlternative[] = [];
  for (const alternative of objectAlternatives) {
    const selected = findLastStaticObjectProperty({
      objectExpression: alternative.expression,
      propertyNames: new Set(projection.propertyNames),
      site: input.site,
      sourceFile: alternative.sourceFile,
      expressionById: alternative.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds: input.seenExpressionIds,
    });
    if (
      (!selected.property || !selected.property.valueExpressionId) &&
      selected.unresolvedEntriesCanAffectResult &&
      projection.unresolvedObjectEntriesAffectPresence
    ) {
      return undefined;
    }
    if (!selected.property?.valueExpressionId) {
      continue;
    }

    const resolved = resolveInlineStyleObjectAlternatives({
      expressionId: selected.property.valueExpressionId,
      site: input.site,
      sourceFile: alternative.sourceFile,
      expressionById: alternative.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds: input.seenExpressionIds,
    });
    if (!resolved || resolved.length === 0) {
      return undefined;
    }
    projectedAlternatives.push(
      ...resolved.map((resolvedAlternative) => ({
        ...resolvedAlternative,
        certainty:
          alternative.certainty === "possible" || resolvedAlternative.certainty === "possible"
            ? ("possible" as const)
            : ("definite" as const),
      })),
    );
  }

  return projectedAlternatives.length > 0 ? projectedAlternatives : undefined;
}

function resolveInlineStyleObjectAlternatives(input: {
  expressionId: string;
  site: ReactInlineStyleSiteFact;
  sourceFile: SourceFrontendFile;
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
  if (expression.expressionKind === "member-access") {
    return resolveInlineStyleObjectMemberAlternatives({
      objectExpressionId: expression.objectExpressionId,
      propertyName: expression.propertyName,
      site: input.site,
      sourceFile: input.sourceFile,
      expressionById: input.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds,
    });
  }
  if (expression.expressionKind === "element-access" && expression.argumentExpressionId) {
    const propertyName = resolveInlineStaticString({
      expressionId: expression.argumentExpressionId,
      site: input.site,
      sourceFile: input.sourceFile,
      expressionById: input.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds,
    });
    if (!propertyName) {
      return undefined;
    }
    return resolveInlineStyleObjectMemberAlternatives({
      objectExpressionId: expression.objectExpressionId,
      propertyName,
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

function resolveInlineStyleObjectMemberAlternatives(input: {
  objectExpressionId: string;
  propertyName: string;
  site: ReactInlineStyleSiteFact;
  sourceFile: SourceFrontendFile;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
}): InlineStyleExpressionAlternative[] | undefined {
  const objectAlternatives = resolveInlineStyleObjectAlternatives({
    expressionId: input.objectExpressionId,
    site: input.site,
    sourceFile: input.sourceFile,
    expressionById: input.expressionById,
    resolutionContext: input.resolutionContext,
    seenExpressionIds: input.seenExpressionIds,
  });
  if (!objectAlternatives || objectAlternatives.length === 0) {
    return undefined;
  }

  const memberAlternatives: InlineStyleExpressionAlternative[] = [];
  for (const alternative of objectAlternatives) {
    const selected = findLastStaticObjectProperty({
      objectExpression: alternative.expression,
      propertyNames: new Set([input.propertyName]),
      site: input.site,
      sourceFile: alternative.sourceFile,
      expressionById: alternative.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds: input.seenExpressionIds,
    });
    if (!selected.property?.valueExpressionId) {
      return undefined;
    }

    const resolved = resolveInlineStyleObjectAlternatives({
      expressionId: selected.property.valueExpressionId,
      site: input.site,
      sourceFile: alternative.sourceFile,
      expressionById: alternative.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds: input.seenExpressionIds,
    });
    if (!resolved || resolved.length === 0) {
      return undefined;
    }
    memberAlternatives.push(...resolved);
  }

  return memberAlternatives.length > 0 ? memberAlternatives : undefined;
}

function resolveInlineStyleIdentifier(input: {
  identifierName: string;
  site: ReactInlineStyleSiteFact;
  sourceFile: SourceFrontendFile;
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

function flattenInlineStyleObject(input: {
  objectExpression: SourceObjectLiteralExpressionSyntax & SourceExpressionSyntaxFact;
  inheritedCertainty: "definite" | "possible";
  site: ReactInlineStyleSiteFact;
  sourceFile: SourceFrontendFile;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
  orderCounter: { value: number };
}): {
  properties: StaticInlineStyleObjectProperty[];
  unsupportedReason?: string;
} {
  if (input.objectExpression.hasUnsupportedProperty) {
    return {
      properties: [],
      unsupportedReason: `Inline style "${input.site.rawExpressionText}" contains unsupported object properties.`,
    };
  }

  const properties: StaticInlineStyleObjectProperty[] = [];
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
          properties: [],
          unsupportedReason: `Inline style "${input.site.rawExpressionText}" contains spread that could not be statically resolved.`,
        };
      }
      if (input.seenExpressionIds.has(spreadObject.expression.expressionId)) {
        return {
          properties: [],
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
      properties.push(...spread.properties);
      continue;
    }

    const flattenedProperty = extractInlineStyleProperty({
      property,
      expressionById: input.expressionById,
      sourceFilePath: input.sourceFile.filePath,
      order: input.orderCounter.value,
    });
    input.orderCounter.value += 1;
    if (flattenedProperty) {
      properties.push(flattenedProperty);
    }
  }

  return { properties };
}

function collapseInlineProperties(
  properties: StaticInlineStyleObjectProperty[],
): StaticInlineStyleObjectProperty[] {
  const declarationsByProperty = new Map<string, StaticInlineStyleObjectProperty>();
  for (const declaration of properties) {
    declarationsByProperty.set(declaration.propertyName, declaration);
  }
  return [...declarationsByProperty.values()].sort((left, right) => left.order - right.order);
}

function resolveInlineStyleSpreadObject(input: {
  property: SourceObjectExpressionProperty;
  site: ReactInlineStyleSiteFact;
  sourceFile: SourceFrontendFile;
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

function extractInlineStyleProperty(input: {
  property: SourceObjectExpressionProperty;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  sourceFilePath: string;
  order: number;
}): StaticInlineStyleObjectProperty | undefined {
  if (
    input.property.propertyKind !== "property" ||
    input.property.keyKind === "computed" ||
    !input.property.keyText ||
    !input.property.valueExpressionId
  ) {
    return undefined;
  }

  return {
    propertyName: input.property.keyText,
    valueExpressionId: input.property.valueExpressionId,
    ...(input.expressionById.get(input.property.valueExpressionId)
      ? { valueExpression: input.expressionById.get(input.property.valueExpressionId) }
      : {}),
    sourceFilePath: input.sourceFilePath,
    location: input.property.location,
    order: input.order,
  };
}

function findLastStaticObjectProperty(input: {
  objectExpression: SourceObjectLiteralExpressionSyntax & SourceExpressionSyntaxFact;
  propertyNames: Set<string>;
  site: ReactInlineStyleSiteFact;
  sourceFile: SourceFrontendFile;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
}): {
  property?: SourceObjectExpressionProperty;
  unresolvedEntriesCanAffectResult: boolean;
} {
  let unresolvedEntriesCanAffectResult = false;
  let selectedProperty: SourceObjectExpressionProperty | undefined;
  for (const property of input.objectExpression.properties) {
    if (property.propertyKind === "spread" || property.propertyKind === "unsupported") {
      unresolvedEntriesCanAffectResult = true;
      continue;
    }
    if (property.propertyKind !== "property" && property.propertyKind !== "shorthand") {
      unresolvedEntriesCanAffectResult = true;
      continue;
    }

    const keyText =
      property.keyKind === "computed" && property.keyExpressionId
        ? resolveInlineStaticString({
            expressionId: property.keyExpressionId,
            site: input.site,
            sourceFile: input.sourceFile,
            expressionById: input.expressionById,
            resolutionContext: input.resolutionContext,
            seenExpressionIds: input.seenExpressionIds,
          })
        : property.keyText;

    if (!keyText) {
      unresolvedEntriesCanAffectResult = true;
      continue;
    }

    if (input.propertyNames.has(keyText)) {
      selectedProperty = property;
      unresolvedEntriesCanAffectResult = false;
    }
  }

  return {
    ...(selectedProperty ? { property: selectedProperty } : {}),
    unresolvedEntriesCanAffectResult,
  };
}

function resolveInlineStaticString(input: {
  expressionId: string;
  site: ReactInlineStyleSiteFact;
  sourceFile: SourceFrontendFile;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
}): string | undefined {
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

  if (expression.expressionKind === "string-literal") {
    return expression.value;
  }
  if (expression.expressionKind === "identifier") {
    const binding = [...input.sourceFile.reactSyntax.localValueBindings]
      .filter(
        (candidate) =>
          candidate.bindingKind === "const-identifier" &&
          candidate.localName === expression.name &&
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
    const expressionId =
      binding?.expressionId ?? binding?.objectExpressionId ?? binding?.initializerExpressionId;
    return expressionId
      ? resolveInlineStaticString({
          ...input,
          expressionId,
          seenExpressionIds,
        })
      : undefined;
  }

  return undefined;
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
