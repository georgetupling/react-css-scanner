import type {
  ClassExpressionSiteNode,
  ComponentNode,
  ComponentPropBindingNode,
  ContainsEdge,
  ElementTemplateNode,
  FactGraphInput,
  FactNodeId,
  HelperDefinitionNode,
  LocalValueBindingNode,
  ReferencesClassExpressionEdge,
  RendersEdge,
  RenderSiteNode,
} from "../types.js";
import {
  classExpressionSiteNodeId,
  componentNodeId,
  componentPropBindingNodeId,
  containsEdgeId,
  elementTemplateNodeId,
  helperDefinitionNodeId,
  localValueBindingNodeId,
  moduleNodeId,
  referencesClassExpressionEdgeId,
  rendersEdgeId,
  renderSiteNodeId,
} from "../ids.js";
import { factGraphProvenance, frontendFileProvenance } from "../provenance.js";
import { sortEdges, sortNodes } from "../utils/sortGraphElements.js";

export type BuiltReactSyntaxFacts = {
  allNodes: Array<
    | ComponentNode
    | RenderSiteNode
    | ElementTemplateNode
    | ClassExpressionSiteNode
    | ComponentPropBindingNode
    | LocalValueBindingNode
    | HelperDefinitionNode
  >;
  components: ComponentNode[];
  renderSites: RenderSiteNode[];
  elementTemplates: ElementTemplateNode[];
  classExpressionSites: ClassExpressionSiteNode[];
  componentPropBindings: ComponentPropBindingNode[];
  localValueBindings: LocalValueBindingNode[];
  helperDefinitions: HelperDefinitionNode[];
  allEdges: Array<ContainsEdge | RendersEdge | ReferencesClassExpressionEdge>;
  contains: ContainsEdge[];
  renders: RendersEdge[];
  referencesClassExpression: ReferencesClassExpressionEdge[];
};

export function buildReactSyntaxFacts(input: FactGraphInput): BuiltReactSyntaxFacts {
  const components: ComponentNode[] = [];
  const renderSites: RenderSiteNode[] = [];
  const elementTemplates: ElementTemplateNode[] = [];
  const classExpressionSites: ClassExpressionSiteNode[] = [];
  const componentPropBindings: ComponentPropBindingNode[] = [];
  const localValueBindings: LocalValueBindingNode[] = [];
  const helperDefinitions: HelperDefinitionNode[] = [];
  const contains: ContainsEdge[] = [];
  const renders: RendersEdge[] = [];
  const referencesClassExpression: ReferencesClassExpressionEdge[] = [];

  for (const file of input.frontends.source.files) {
    const moduleId = moduleNodeId(file.filePath);

    for (const component of file.reactSyntax.components) {
      const nodeId = componentNodeId(component.componentKey);
      components.push({
        id: nodeId,
        kind: "component",
        componentKey: component.componentKey,
        componentName: component.componentName,
        filePath: component.filePath,
        exported: component.exported,
        declarationKind: component.declarationKind,
        location: component.location,
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: component.filePath,
          summary: "Extracted React component declaration frontend fact",
        }),
      });
      contains.push(buildContainsEdge(moduleId, nodeId, "module-component"));
    }

    for (const propBinding of file.reactSyntax.componentPropBindings) {
      const nodeId = componentPropBindingNodeId(propBinding.bindingKey);
      const componentId = componentNodeId(propBinding.componentKey);
      componentPropBindings.push({
        ...propBinding,
        id: nodeId,
        kind: "component-prop-binding",
        componentNodeId: componentId,
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: propBinding.filePath,
          summary: "Extracted React component prop-binding frontend fact",
        }),
      });
      contains.push(buildContainsEdge(componentId, nodeId, "component-prop-binding"));
    }

    for (const helper of file.reactSyntax.helperDefinitions) {
      const nodeId = helperDefinitionNodeId(helper.helperKey);
      const ownerNodeId = helperOwnerNodeId(helper);
      helperDefinitions.push({
        ...helper,
        id: nodeId,
        kind: "helper-definition",
        ownerNodeId,
        ...(helper.returnExpressionId ? { returnExpressionNodeId: helper.returnExpressionId } : {}),
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: helper.filePath,
          summary: "Extracted React helper-definition frontend fact",
        }),
      });
      contains.push(
        buildContainsEdge(ownerNodeId, nodeId, helperContainmentKind(helper.ownerKind)),
      );
    }

    for (const localBinding of file.reactSyntax.localValueBindings) {
      const nodeId = localValueBindingNodeId(localBinding.bindingKey);
      const ownerNodeId =
        localBinding.ownerKind === "component"
          ? componentNodeId(localBinding.ownerKey)
          : helperDefinitionNodeId(localBinding.ownerKey);
      localValueBindings.push({
        ...localBinding,
        id: nodeId,
        kind: "local-value-binding",
        ownerNodeId,
        ...(localBinding.expressionId ? { expressionNodeId: localBinding.expressionId } : {}),
        ...(localBinding.objectExpressionId
          ? { objectExpressionNodeId: localBinding.objectExpressionId }
          : {}),
        ...(localBinding.initializerExpressionId
          ? { initializerExpressionNodeId: localBinding.initializerExpressionId }
          : {}),
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: localBinding.filePath,
          summary: "Extracted React local value-binding frontend fact",
        }),
      });
      contains.push(
        buildContainsEdge(
          ownerNodeId,
          nodeId,
          localBinding.ownerKind === "component"
            ? "component-local-value-binding"
            : "helper-local-value-binding",
        ),
      );
    }

    for (const renderSite of file.reactSyntax.renderSites) {
      const nodeId = renderSiteNodeId(renderSite.siteKey);
      renderSites.push({
        id: nodeId,
        kind: "render-site",
        renderSiteKey: renderSite.siteKey,
        renderSiteKind: renderSite.kind,
        filePath: renderSite.filePath,
        location: renderSite.location,
        ...(renderSite.emittingComponentKey
          ? { emittingComponentNodeId: componentNodeId(renderSite.emittingComponentKey) }
          : {}),
        ...(renderSite.placementComponentKey
          ? { placementComponentNodeId: componentNodeId(renderSite.placementComponentKey) }
          : {}),
        ...(renderSite.parentSiteKey
          ? { parentRenderSiteNodeId: renderSiteNodeId(renderSite.parentSiteKey) }
          : {}),
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: renderSite.filePath,
          summary: "Extracted React render-site frontend fact",
        }),
      });

      if (renderSite.emittingComponentKey) {
        contains.push(
          buildContainsEdge(
            componentNodeId(renderSite.emittingComponentKey),
            nodeId,
            "component-render-site",
          ),
        );
      }
      if (renderSite.parentSiteKey) {
        contains.push(
          buildContainsEdge(
            renderSiteNodeId(renderSite.parentSiteKey),
            nodeId,
            "render-site-child-site",
          ),
        );
      }
    }

    for (const template of file.reactSyntax.elementTemplates) {
      const nodeId = elementTemplateNodeId(template.templateKey);
      elementTemplates.push({
        id: nodeId,
        kind: "element-template",
        templateKey: template.templateKey,
        templateKind: template.kind,
        name: template.name,
        filePath: template.filePath,
        location: template.location,
        renderSiteNodeId: renderSiteNodeId(template.renderSiteKey),
        ...(template.emittingComponentKey
          ? { emittingComponentNodeId: componentNodeId(template.emittingComponentKey) }
          : {}),
        ...(template.placementComponentKey
          ? { placementComponentNodeId: componentNodeId(template.placementComponentKey) }
          : {}),
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: template.filePath,
          summary: "Extracted React element-template frontend fact",
        }),
      });
      contains.push(
        buildContainsEdge(
          renderSiteNodeId(template.renderSiteKey),
          nodeId,
          "render-site-element-template",
        ),
      );

      if (template.kind === "component-candidate" && template.emittingComponentKey) {
        const targetComponentId = findComponentNodeIdByName({
          components,
          componentName: template.name.split(".").at(-1) ?? template.name,
        });
        if (targetComponentId) {
          renders.push(
            buildRendersEdge(componentNodeId(template.emittingComponentKey), targetComponentId),
          );
        }
      }
    }

    for (const classSite of [
      ...file.reactSyntax.classExpressionSites,
      ...file.runtimeDomClassSites.map((site) => ({
        siteKey: [
          "class-expression",
          site.location.filePath.replace(/\\/g, "/"),
          site.location.startLine,
          site.location.startColumn,
          site.location.endLine ?? 0,
          site.location.endColumn ?? 0,
          "runtime-dom",
        ].join(":"),
        kind: "runtime-dom-class" as const,
        filePath: site.filePath,
        location: site.location,
        expressionId: site.expressionId,
        rawExpressionText: site.rawExpressionText,
        emittingComponentKey: undefined,
        placementComponentKey: undefined,
        renderSiteKey: undefined,
        elementTemplateKey: undefined,
      })),
    ]) {
      const nodeId = classExpressionSiteNodeId(classSite.siteKey);
      classExpressionSites.push({
        id: nodeId,
        kind: "class-expression-site",
        classExpressionSiteKey: classSite.siteKey,
        classExpressionSiteKind: classSite.kind,
        filePath: classSite.filePath,
        location: classSite.location,
        expressionId: classSite.expressionId,
        expressionNodeId: classSite.expressionId,
        rawExpressionText: classSite.rawExpressionText,
        ...(classSite.emittingComponentKey
          ? { emittingComponentNodeId: componentNodeId(classSite.emittingComponentKey) }
          : {}),
        ...(classSite.placementComponentKey
          ? { placementComponentNodeId: componentNodeId(classSite.placementComponentKey) }
          : {}),
        ...(classSite.renderSiteKey
          ? { renderSiteNodeId: renderSiteNodeId(classSite.renderSiteKey) }
          : {}),
        ...(classSite.elementTemplateKey
          ? { elementTemplateNodeId: elementTemplateNodeId(classSite.elementTemplateKey) }
          : {}),
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: classSite.filePath,
          summary: "Extracted class-expression-site frontend fact",
        }),
      });

      if (classSite.renderSiteKey) {
        referencesClassExpression.push(
          buildReferencesClassExpressionEdge(renderSiteNodeId(classSite.renderSiteKey), nodeId),
        );
      }
      if (classSite.elementTemplateKey) {
        referencesClassExpression.push(
          buildReferencesClassExpressionEdge(
            elementTemplateNodeId(classSite.elementTemplateKey),
            nodeId,
          ),
        );
      }
    }
  }

  return {
    allNodes: sortNodes([
      ...components,
      ...renderSites,
      ...elementTemplates,
      ...classExpressionSites,
      ...componentPropBindings,
      ...localValueBindings,
      ...helperDefinitions,
    ]),
    components: sortNodes(components),
    renderSites: sortNodes(renderSites),
    elementTemplates: sortNodes(elementTemplates),
    classExpressionSites: sortNodes(classExpressionSites),
    componentPropBindings: sortNodes(componentPropBindings),
    localValueBindings: sortNodes(localValueBindings),
    helperDefinitions: sortNodes(helperDefinitions),
    allEdges: sortEdges([...contains, ...renders, ...referencesClassExpression]),
    contains: sortEdges(contains),
    renders: sortEdges(renders),
    referencesClassExpression: sortEdges(referencesClassExpression),
  };
}

function helperOwnerNodeId(helper: {
  ownerKind: HelperDefinitionNode["ownerKind"];
  ownerKey: string;
  filePath: string;
}): FactNodeId {
  if (helper.ownerKind === "source-file") {
    return moduleNodeId(helper.filePath);
  }

  if (helper.ownerKind === "component") {
    return componentNodeId(helper.ownerKey);
  }

  return helperDefinitionNodeId(helper.ownerKey);
}

function helperContainmentKind(
  ownerKind: HelperDefinitionNode["ownerKind"],
): ContainsEdge["containmentKind"] {
  if (ownerKind === "source-file") {
    return "module-helper-definition";
  }

  if (ownerKind === "component") {
    return "component-helper-definition";
  }

  return "helper-nested-helper-definition";
}

function buildContainsEdge(
  from: string,
  to: string,
  containmentKind: ContainsEdge["containmentKind"],
): ContainsEdge {
  return {
    id: containsEdgeId(from, to),
    kind: "contains",
    from,
    to,
    containmentKind,
    confidence: "high",
    provenance: factGraphProvenance("Linked React syntax graph facts"),
  };
}

function buildRendersEdge(from: string, to: string): RendersEdge {
  return {
    id: rendersEdgeId(from, to),
    kind: "renders",
    from,
    to,
    confidence: "high",
    provenance: factGraphProvenance("Linked React component render facts"),
  };
}

function buildReferencesClassExpressionEdge(
  from: string,
  to: string,
): ReferencesClassExpressionEdge {
  return {
    id: referencesClassExpressionEdgeId(from, to),
    kind: "references-class-expression",
    from,
    to,
    confidence: "high",
    provenance: factGraphProvenance("Linked class expression site to syntax owner"),
  };
}

function findComponentNodeIdByName(input: {
  components: ComponentNode[];
  componentName: string;
}): string | undefined {
  const matches = input.components.filter(
    (component) => component.componentName === input.componentName,
  );
  return matches.length === 1 ? matches[0].id : undefined;
}
