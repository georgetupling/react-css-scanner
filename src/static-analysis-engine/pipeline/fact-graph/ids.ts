import type { FactEdgeId, FactNodeId } from "./types.js";

export function fileResourceNodeId(filePath: string): FactNodeId {
  return `file:${normalizeIdPart(filePath)}`;
}

export function moduleNodeId(filePath: string): FactNodeId {
  return `module:${normalizeIdPart(filePath)}`;
}

export function stylesheetNodeId(filePath: string): FactNodeId {
  return `stylesheet:${normalizeIdPart(filePath)}`;
}

export function ruleDefinitionNodeId(stylesheetId: FactNodeId, ruleIndex: number): FactNodeId {
  return `rule:${stylesheetId}:${ruleIndex}`;
}

export function selectorNodeId(stylesheetId: FactNodeId, ruleIndex: number): FactNodeId {
  return `selector:${stylesheetId}:${ruleIndex}`;
}

export function selectorBranchNodeId(
  stylesheetId: FactNodeId,
  ruleIndex: number,
  branchIndex: number,
): FactNodeId {
  return `selector-branch:${stylesheetId}:${ruleIndex}:${branchIndex}`;
}

export function originatesFromFileEdgeId(from: FactNodeId, to: FactNodeId): FactEdgeId {
  return `originates-from-file:${from}->${to}`;
}

export function containsEdgeId(from: FactNodeId, to: FactNodeId): FactEdgeId {
  return `contains:${from}->${to}`;
}

export function definesSelectorEdgeId(from: FactNodeId, to: FactNodeId): FactEdgeId {
  return `defines-selector:${from}->${to}`;
}

export function importsEdgeId(
  from: FactNodeId,
  to: FactNodeId,
  specifier: string,
  importKind: string,
  importLoading = "static",
): FactEdgeId {
  const loadingSuffix = importLoading === "static" ? "" : `:${importLoading}`;
  return `imports:${from}->${to}:${specifier}:${importKind}${loadingSuffix}`;
}

export function externalResourceNodeId(specifier: string, resourceKind: string): FactNodeId {
  return `external:${resourceKind}:${normalizeIdPart(specifier)}`;
}

export function componentNodeId(componentKey: string): FactNodeId {
  return `component:${normalizeIdPart(componentKey)}`;
}

export function renderSiteNodeId(siteKey: string): FactNodeId {
  return `render-site:${normalizeIdPart(siteKey)}`;
}

export function elementTemplateNodeId(templateKey: string): FactNodeId {
  return `element-template:${normalizeIdPart(templateKey)}`;
}

export function classExpressionSiteNodeId(siteKey: string): FactNodeId {
  return `class-expression-site:${normalizeIdPart(siteKey)}`;
}

export function componentPropBindingNodeId(bindingKey: string): FactNodeId {
  return `component-prop-binding:${normalizeIdPart(bindingKey)}`;
}

export function localValueBindingNodeId(bindingKey: string): FactNodeId {
  return `local-value-binding:${normalizeIdPart(bindingKey)}`;
}

export function helperDefinitionNodeId(helperKey: string): FactNodeId {
  return `helper-definition:${normalizeIdPart(helperKey)}`;
}

export function rendersEdgeId(from: FactNodeId, to: FactNodeId): FactEdgeId {
  return `renders:${from}->${to}`;
}

export function referencesClassExpressionEdgeId(from: FactNodeId, to: FactNodeId): FactEdgeId {
  return `references-class-expression:${from}->${to}`;
}

export function ownerCandidateNodeId(ownerKind: string, ownerKey: string): FactNodeId {
  return `owner:${ownerKind}:${normalizeIdPart(ownerKey)}`;
}

export function belongsToOwnerCandidateEdgeId(from: FactNodeId, to: FactNodeId): FactEdgeId {
  return `belongs-to-owner-candidate:${from}->${to}`;
}

export function normalizeIdPart(value: string): string {
  return value.replace(/\\/g, "/");
}
