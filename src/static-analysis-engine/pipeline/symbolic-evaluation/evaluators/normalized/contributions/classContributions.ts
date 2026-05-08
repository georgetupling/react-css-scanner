import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import {
  conditionId,
  cssModuleContributionId,
  externalContributionId,
} from "../../../model/ids.js";
import type {
  CssModuleClassContribution,
  ExternalClassContribution,
  SymbolicExpressionEvaluatorInput,
} from "../../../model/types.js";
import { getExpressionSyntax } from "../expressionSyntaxLookup.js";
import {
  collectChildExpressionSyntax,
  getLocalBindingExpressionSyntax,
} from "./expressionTraversal.js";
import {
  resolveLocalValueBindingsForIdentifier,
  sourceAnchorContains,
} from "../bindings/scopeResolution.js";

export function buildExternalContributions(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: { id: string };
  syntax: ExpressionSyntaxNode;
}): ExternalClassContribution[] {
  const syntax = input.syntax;
  const componentNodeId = input.input.classExpressionSite.emittingComponentNodeId;
  if (!componentNodeId) {
    return [];
  }
  const bindingNodeId =
    input.input.graph.indexes.componentPropBindingNodeIdByComponentNodeId.get(componentNodeId);
  const bindingNode = bindingNodeId
    ? input.input.graph.indexes.nodesById.get(bindingNodeId)
    : undefined;
  if (!bindingNode || bindingNode.kind !== "component-prop-binding") {
    return [];
  }

  const contributionsByKey = new Map<string, ExternalClassContribution>();
  const seenExpressionIds = new Set<string>();
  const queue: ExpressionSyntaxNode[] = [syntax];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seenExpressionIds.has(current.expressionId)) {
      continue;
    }
    seenExpressionIds.add(current.expressionId);

    if (
      bindingNode.bindingKind === "destructured-props" &&
      current.expressionKind === "identifier"
    ) {
      if (
        bindingNode.restPropertyName === current.name &&
        input.input.classExpressionSite.componentPropName
      ) {
        const propName = input.input.classExpressionSite.componentPropName;
        const contributionKey = `${propName}:${current.location.startLine}:${current.location.startColumn}`;
        contributionsByKey.set(contributionKey, {
          id: externalContributionId({
            expressionId: input.expression.id,
            contributionKey,
            index: 0,
          }),
          contributionKind: "component-prop",
          localName: current.name,
          propertyName: propName,
          sourceAnchor: current.location,
          conditionId: conditionId({ expressionId: input.expression.id, conditionKey: "always" }),
          confidence: "medium",
          reason: `component prop "${propName}" via rest-prop spread`,
        });
      }

      const property = bindingNode.properties.find(
        (candidate) => candidate.localName === current.name,
      );
      if (property) {
        const contributionKey = `${property.propertyName}:${current.location.startLine}:${current.location.startColumn}`;
        contributionsByKey.set(contributionKey, {
          id: externalContributionId({
            expressionId: input.expression.id,
            contributionKey,
            index: 0,
          }),
          contributionKind: "component-prop",
          localName: property.localName,
          propertyName: property.propertyName,
          sourceAnchor: current.location,
          conditionId: conditionId({ expressionId: input.expression.id, conditionKey: "always" }),
          confidence: "high",
          reason: `component prop "${property.propertyName}" via destructured binding`,
        });
      }
    }

    if (
      bindingNode.bindingKind === "props-identifier" &&
      current.expressionKind === "identifier" &&
      current.name === bindingNode.identifierName &&
      input.input.classExpressionSite.componentPropName &&
      !isComponentPropIdentifierShadowedByRepeatedRenderCallback(input.input, current)
    ) {
      const propName = input.input.classExpressionSite.componentPropName;
      const contributionKey = `${propName}:${current.location.startLine}:${current.location.startColumn}`;
      contributionsByKey.set(contributionKey, {
        id: externalContributionId({
          expressionId: input.expression.id,
          contributionKey,
          index: 0,
        }),
        contributionKind: "component-prop",
        localName: bindingNode.identifierName,
        propertyName: propName,
        sourceAnchor: current.location,
        conditionId: conditionId({ expressionId: input.expression.id, conditionKey: "always" }),
        confidence: "medium",
        reason: `component prop "${propName}" via props spread`,
      });
    }

    if (
      bindingNode.bindingKind === "props-identifier" &&
      current.expressionKind === "member-access"
    ) {
      const objectExpression = getExpressionSyntax(input.input, current.objectExpressionId);
      if (
        objectExpression?.expressionKind === "identifier" &&
        objectExpression.name === bindingNode.identifierName &&
        !isComponentPropIdentifierShadowedByRepeatedRenderCallback(input.input, objectExpression)
      ) {
        const contributionKey = `${current.propertyName}:${current.location.startLine}:${current.location.startColumn}`;
        contributionsByKey.set(contributionKey, {
          id: externalContributionId({
            expressionId: input.expression.id,
            contributionKey,
            index: 0,
          }),
          contributionKind: "component-prop",
          localName: bindingNode.identifierName,
          propertyName: current.propertyName,
          sourceAnchor: current.location,
          conditionId: conditionId({ expressionId: input.expression.id, conditionKey: "always" }),
          confidence: "high",
          reason: `component prop "${current.propertyName}" via props member access`,
        });
      }
    }

    if (current.expressionKind === "identifier") {
      const localBindings = resolveLocalValueBindingsForIdentifier({
        input: input.input,
        rootOwnerNodeId: componentNodeId,
        identifierName: current.name,
        targetLocation: current.location,
      });
      for (const localBinding of localBindings) {
        const contribution = buildExternalContributionFromLocalBinding({
          input: input.input,
          expressionId: input.expression.id,
          bindingNode,
          localBinding,
          sourceExpression: current,
        });
        if (contribution) {
          contributionsByKey.set(contribution.key, contribution.contribution);
        }

        const boundExpressions = getLocalBindingExpressionSyntax(input.input, localBinding);
        queue.push(...boundExpressions);
      }
    }

    queue.push(...collectChildExpressionSyntax(input.input, current));
  }

  return [...contributionsByKey.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function isComponentPropIdentifierShadowedByRepeatedRenderCallback(
  input: SymbolicExpressionEvaluatorInput,
  identifier: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>,
): boolean {
  const renderSiteNodeId = input.classExpressionSite.renderSiteNodeId;
  const renderSite = renderSiteNodeId
    ? input.graph.indexes.nodesById.get(renderSiteNodeId)
    : undefined;
  if (
    !renderSite ||
    renderSite.kind !== "render-site" ||
    !renderSite.repeatedRegion?.callbackParameterNames?.includes(identifier.name)
  ) {
    return false;
  }

  return sourceAnchorContains(renderSite.location, identifier.location);
}

function buildExternalContributionFromLocalBinding(input: {
  input: SymbolicExpressionEvaluatorInput;
  expressionId: string;
  bindingNode: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["componentPropBindings"][number];
  localBinding: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number];
  sourceExpression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
}): { key: string; contribution: ExternalClassContribution } | undefined {
  if (
    input.bindingNode.bindingKind !== "props-identifier" ||
    input.localBinding.bindingKind !== "destructured-property" ||
    !input.localBinding.propertyName ||
    !input.localBinding.objectExpressionId
  ) {
    return undefined;
  }

  const objectExpression = getExpressionSyntax(input.input, input.localBinding.objectExpressionId);
  if (
    objectExpression?.expressionKind !== "identifier" ||
    objectExpression.name !== input.bindingNode.identifierName
  ) {
    return undefined;
  }

  const contributionKey = `${input.localBinding.propertyName}:${input.sourceExpression.location.startLine}:${input.sourceExpression.location.startColumn}`;
  return {
    key: contributionKey,
    contribution: {
      id: externalContributionId({
        expressionId: input.expressionId,
        contributionKey,
        index: 0,
      }),
      contributionKind: "component-prop",
      localName: input.localBinding.localName,
      propertyName: input.localBinding.propertyName,
      sourceAnchor: input.sourceExpression.location,
      conditionId: conditionId({ expressionId: input.expressionId, conditionKey: "always" }),
      confidence: "high",
      reason: `component prop "${input.localBinding.propertyName}" via local destructuring`,
    },
  };
}

export function buildCssModuleContributionFromDestructuredIdentifier(input: {
  input: SymbolicExpressionEvaluatorInput;
  expressionId: string;
  syntax: ExpressionSyntaxNode;
}): CssModuleClassContribution | undefined {
  if (input.syntax.expressionKind !== "identifier") {
    return undefined;
  }

  const rootOwnerNodeId = input.input.classExpressionSite.emittingComponentNodeId;
  if (!rootOwnerNodeId) {
    return undefined;
  }

  const localBindings = resolveLocalValueBindingsForIdentifier({
    input: input.input,
    rootOwnerNodeId,
    identifierName: input.syntax.name,
    targetLocation: input.syntax.location,
  });

  for (const binding of localBindings) {
    if (
      binding.bindingKind !== "destructured-property" ||
      !binding.propertyName ||
      !binding.objectExpressionId
    ) {
      continue;
    }

    const objectExpression = getExpressionSyntax(input.input, binding.objectExpressionId);
    if (!objectExpression || objectExpression.expressionKind !== "identifier") {
      continue;
    }

    const cssModuleImport = resolveCssModuleImportForNamespace({
      input: input.input,
      sourceFilePath: input.syntax.filePath,
      localName: objectExpression.name,
    });
    if (!cssModuleImport) {
      continue;
    }

    return {
      id: cssModuleContributionId({
        expressionId: input.expressionId,
        exportName: binding.propertyName,
        index: 0,
      }),
      ...(cssModuleImport.stylesheetNodeId
        ? { stylesheetNodeId: cssModuleImport.stylesheetNodeId }
        : {}),
      ...(cssModuleImport.stylesheetFilePath
        ? { stylesheetFilePath: cssModuleImport.stylesheetFilePath }
        : {}),
      localName: binding.localName,
      originLocalName: objectExpression.name,
      exportName: binding.propertyName,
      accessKind: "destructured-binding",
      conditionId: conditionId({ expressionId: input.expressionId, conditionKey: "always" }),
      sourceAnchor: input.syntax.location,
      confidence: "high",
      traces: [],
    };
  }

  return undefined;
}

function resolveCssModuleImportForNamespace(input: {
  input: SymbolicExpressionEvaluatorInput;
  sourceFilePath: string;
  localName: string;
}): { stylesheetNodeId?: string; stylesheetFilePath?: string } | undefined {
  const importEdge = input.input.graph.edges.imports.find(
    (edge) =>
      edge.importerKind === "source" &&
      edge.importKind === "css" &&
      normalizePath(edge.importerFilePath) === normalizePath(input.sourceFilePath) &&
      edge.resolutionStatus === "resolved" &&
      edge.resolvedFilePath &&
      edge.importNames?.some((importName) => importName.localName === input.localName),
  );
  if (!importEdge?.resolvedFilePath) {
    return undefined;
  }
  const resolvedFilePath = importEdge.resolvedFilePath;

  const stylesheetNode = input.input.graph.nodes.stylesheets.find(
    (node) =>
      node.filePath &&
      normalizePath(node.filePath) === normalizePath(resolvedFilePath) &&
      node.cssKind === "css-module",
  );
  if (!stylesheetNode) {
    return undefined;
  }

  return {
    stylesheetNodeId: stylesheetNode.id,
    stylesheetFilePath: stylesheetNode.filePath,
  };
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
