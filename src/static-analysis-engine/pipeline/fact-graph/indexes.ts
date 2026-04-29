import type { FactEdge, FactGraphDiagnostic, FactGraphIndexes, FactNode } from "./types.js";
import { factGraphProvenance } from "./provenance.js";

export function buildFactGraphIndexes(input: { nodes: FactNode[]; edges: FactEdge[] }): {
  indexes: FactGraphIndexes;
  diagnostics: FactGraphDiagnostic[];
} {
  const diagnostics: FactGraphDiagnostic[] = [];
  const nodesById = new Map<string, FactNode>();
  const edgesById = new Map<string, FactEdge>();
  const fileNodeIdByPath = new Map<string, string>();
  const moduleNodeIdByFilePath = new Map<string, string>();
  const stylesheetNodeIdByFilePath = new Map<string, string>();
  const componentNodeIdByComponentKey = new Map<string, string>();
  const componentNodeIdsByFilePath = new Map<string, string[]>();
  const renderSiteNodeIdByRenderSiteKey = new Map<string, string>();
  const renderSiteNodeIdsByComponentNodeId = new Map<string, string[]>();
  const elementTemplateNodeIdByTemplateKey = new Map<string, string>();
  const classExpressionSiteNodeIdBySiteKey = new Map<string, string>();
  const classExpressionSiteNodeIdsByComponentNodeId = new Map<string, string[]>();
  const expressionSyntaxNodeIdByExpressionId = new Map<string, string>();
  const expressionSyntaxNodeIdsByFilePath = new Map<string, string[]>();
  const componentPropBindingNodeIdByBindingKey = new Map<string, string>();
  const componentPropBindingNodeIdByComponentNodeId = new Map<string, string>();
  const localValueBindingNodeIdByBindingKey = new Map<string, string>();
  const localValueBindingNodeIdsByOwnerNodeId = new Map<string, string[]>();
  const helperDefinitionNodeIdByHelperKey = new Map<string, string>();
  const helperDefinitionNodeIdsByOwnerNodeId = new Map<string, string[]>();
  const ownerCandidateNodeIdsByOwnerKind = new Map<string, string[]>();
  const ruleDefinitionNodeIdsByStylesheetNodeId = new Map<string, string[]>();
  const selectorNodeIdsByStylesheetNodeId = new Map<string, string[]>();
  const selectorBranchNodeIdsByStylesheetNodeId = new Map<string, string[]>();
  const selectorBranchNodeIdsByRequiredClassName = new Map<string, string[]>();

  for (const node of input.nodes) {
    if (nodesById.has(node.id)) {
      diagnostics.push({
        stage: "fact-graph",
        severity: "error",
        code: "duplicate-graph-id",
        message: `Duplicate fact graph node id: ${node.id}`,
        provenance: factGraphProvenance("Detected duplicate fact graph node id"),
      });
    }

    nodesById.set(node.id, node);

    if (node.kind === "file-resource") {
      fileNodeIdByPath.set(node.filePath, node.id);
    } else if (node.kind === "module") {
      moduleNodeIdByFilePath.set(node.filePath, node.id);
    } else if (node.kind === "component") {
      componentNodeIdByComponentKey.set(node.componentKey, node.id);
      pushMapValue(componentNodeIdsByFilePath, node.filePath, node.id);
    } else if (node.kind === "render-site") {
      renderSiteNodeIdByRenderSiteKey.set(node.renderSiteKey, node.id);
      if (node.emittingComponentNodeId) {
        pushMapValue(renderSiteNodeIdsByComponentNodeId, node.emittingComponentNodeId, node.id);
      }
    } else if (node.kind === "element-template") {
      elementTemplateNodeIdByTemplateKey.set(node.templateKey, node.id);
    } else if (node.kind === "class-expression-site") {
      classExpressionSiteNodeIdBySiteKey.set(node.classExpressionSiteKey, node.id);
      if (node.emittingComponentNodeId) {
        pushMapValue(
          classExpressionSiteNodeIdsByComponentNodeId,
          node.emittingComponentNodeId,
          node.id,
        );
      }
    } else if (node.kind === "expression-syntax") {
      expressionSyntaxNodeIdByExpressionId.set(node.expressionId, node.id);
      pushMapValue(expressionSyntaxNodeIdsByFilePath, node.filePath, node.id);
    } else if (node.kind === "component-prop-binding") {
      componentPropBindingNodeIdByBindingKey.set(node.bindingKey, node.id);
      componentPropBindingNodeIdByComponentNodeId.set(node.componentNodeId, node.id);
    } else if (node.kind === "local-value-binding") {
      localValueBindingNodeIdByBindingKey.set(node.bindingKey, node.id);
      pushMapValue(localValueBindingNodeIdsByOwnerNodeId, node.ownerNodeId, node.id);
    } else if (node.kind === "helper-definition") {
      helperDefinitionNodeIdByHelperKey.set(node.helperKey, node.id);
      pushMapValue(helperDefinitionNodeIdsByOwnerNodeId, node.ownerNodeId, node.id);
    } else if (node.kind === "owner-candidate") {
      pushMapValue(ownerCandidateNodeIdsByOwnerKind, node.ownerCandidateKind, node.id);
    } else if (node.kind === "stylesheet" && node.filePath) {
      stylesheetNodeIdByFilePath.set(node.filePath, node.id);
    } else if (node.kind === "rule-definition") {
      pushMapValue(ruleDefinitionNodeIdsByStylesheetNodeId, node.stylesheetNodeId, node.id);
    } else if (node.kind === "selector" && node.stylesheetNodeId) {
      pushMapValue(selectorNodeIdsByStylesheetNodeId, node.stylesheetNodeId, node.id);
    } else if (node.kind === "selector-branch") {
      if (node.stylesheetNodeId) {
        pushMapValue(selectorBranchNodeIdsByStylesheetNodeId, node.stylesheetNodeId, node.id);
      }

      for (const className of node.requiredClassNames) {
        pushMapValue(selectorBranchNodeIdsByRequiredClassName, className, node.id);
      }
    }
  }

  for (const edge of input.edges) {
    if (edgesById.has(edge.id)) {
      diagnostics.push({
        stage: "fact-graph",
        severity: "error",
        code: "duplicate-graph-id",
        message: `Duplicate fact graph edge id: ${edge.id}`,
        provenance: factGraphProvenance("Detected duplicate fact graph edge id"),
      });
    }

    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      diagnostics.push({
        stage: "fact-graph",
        severity: "error",
        code: "unresolved-graph-edge-target",
        message: `Fact graph edge ${edge.id} references a missing node`,
        provenance: edge.provenance,
      });
    }

    edgesById.set(edge.id, edge);
  }

  return {
    indexes: {
      nodesById,
      edgesById,
      fileNodeIdByPath,
      moduleNodeIdByFilePath,
      stylesheetNodeIdByFilePath,
      componentNodeIdByComponentKey,
      componentNodeIdsByFilePath: sortMapValues(componentNodeIdsByFilePath),
      renderSiteNodeIdByRenderSiteKey,
      renderSiteNodeIdsByComponentNodeId: sortMapValues(renderSiteNodeIdsByComponentNodeId),
      elementTemplateNodeIdByTemplateKey,
      classExpressionSiteNodeIdBySiteKey,
      classExpressionSiteNodeIdsByComponentNodeId: sortMapValues(
        classExpressionSiteNodeIdsByComponentNodeId,
      ),
      expressionSyntaxNodeIdByExpressionId,
      expressionSyntaxNodeIdsByFilePath: sortMapValues(expressionSyntaxNodeIdsByFilePath),
      componentPropBindingNodeIdByBindingKey,
      componentPropBindingNodeIdByComponentNodeId,
      localValueBindingNodeIdByBindingKey,
      localValueBindingNodeIdsByOwnerNodeId: sortMapValues(localValueBindingNodeIdsByOwnerNodeId),
      helperDefinitionNodeIdByHelperKey,
      helperDefinitionNodeIdsByOwnerNodeId: sortMapValues(helperDefinitionNodeIdsByOwnerNodeId),
      ownerCandidateNodeIdsByOwnerKind: sortMapValues(ownerCandidateNodeIdsByOwnerKind),
      ruleDefinitionNodeIdsByStylesheetNodeId: sortMapValues(
        ruleDefinitionNodeIdsByStylesheetNodeId,
      ),
      selectorNodeIdsByStylesheetNodeId: sortMapValues(selectorNodeIdsByStylesheetNodeId),
      selectorBranchNodeIdsByStylesheetNodeId: sortMapValues(
        selectorBranchNodeIdsByStylesheetNodeId,
      ),
      selectorBranchNodeIdsByRequiredClassName: sortMapValues(
        selectorBranchNodeIdsByRequiredClassName,
      ),
    },
    diagnostics,
  };
}

function pushMapValue(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sortMapValues(map: Map<string, string[]>): Map<string, string[]> {
  return new Map(
    [...map.entries()].map(([key, values]) => [
      key,
      [...values].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}
