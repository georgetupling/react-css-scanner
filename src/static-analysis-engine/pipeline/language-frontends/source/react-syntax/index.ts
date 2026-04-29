import ts from "typescript";

import { collectComponentLikeDefinitions } from "../../../../libraries/react-components/index.js";
import { toSourceAnchor } from "../../../../libraries/react-components/reactComponentAstUtils.js";
import { createComponentKey } from "../../../render-model/componentIdentity.js";
import type { SourceAnchor } from "../../../../types/core.js";
import type { SourceModuleSyntaxFacts } from "../module-syntax/index.js";

export type SourceReactSyntaxFacts = {
  components: ReactComponentDeclarationFact[];
  renderSites: ReactRenderSiteFact[];
  elementTemplates: ReactElementTemplateFact[];
  classExpressionSites: ReactClassExpressionSiteFact[];
};

export type ReactComponentDeclarationFact = {
  componentKey: string;
  componentName: string;
  filePath: string;
  exported: boolean;
  declarationKind: "function" | "variable" | "class";
  evidence: string;
  location: SourceAnchor;
};

export type ReactRenderSiteFact = {
  siteKey: string;
  kind:
    | "component-root"
    | "jsx-element"
    | "component-reference"
    | "jsx-fragment"
    | "conditional"
    | "helper-return";
  filePath: string;
  location: SourceAnchor;
  emittingComponentKey?: string;
  placementComponentKey?: string;
  parentSiteKey?: string;
  elementTemplateKey?: string;
};

export type ReactElementTemplateFact = {
  templateKey: string;
  kind: "intrinsic" | "component-candidate" | "fragment";
  filePath: string;
  location: SourceAnchor;
  name: string;
  renderSiteKey: string;
  emittingComponentKey?: string;
  placementComponentKey?: string;
};

export type ReactClassExpressionSiteFact = {
  siteKey: string;
  kind: "jsx-class" | "component-prop-class" | "css-module-member" | "runtime-dom-class";
  filePath: string;
  location: SourceAnchor;
  rawExpressionText: string;
  emittingComponentKey?: string;
  placementComponentKey?: string;
  renderSiteKey?: string;
  elementTemplateKey?: string;
};

export function collectSourceReactSyntax(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  moduleSyntax: SourceModuleSyntaxFacts;
}): SourceReactSyntaxFacts {
  const components = collectComponentLikeDefinitions({
    filePath: input.filePath,
    parsedSourceFile: input.sourceFile,
  }).map(
    (definition): ReactComponentDeclarationFact => ({
      componentKey: createComponentKey({
        filePath: input.filePath,
        sourceAnchor: definition.sourceAnchor,
        componentName: definition.componentName,
      }),
      componentName: definition.componentName,
      filePath: input.filePath,
      exported: definition.exported,
      declarationKind: definition.declarationKind,
      evidence: definition.evidence,
      location: definition.sourceAnchor,
    }),
  );
  const componentKeyByFunction = new Map<ts.Node, string>();
  for (const definition of collectComponentLikeDefinitions({
    filePath: input.filePath,
    parsedSourceFile: input.sourceFile,
  })) {
    if (definition.functionLikeNode) {
      componentKeyByFunction.set(
        definition.functionLikeNode,
        createComponentKey({
          filePath: input.filePath,
          sourceAnchor: definition.sourceAnchor,
          componentName: definition.componentName,
        }),
      );
    }
  }

  const cssModuleNamespaceNames = collectCssModuleNamespaceNames(input.moduleSyntax);
  const renderSites: ReactRenderSiteFact[] = [];
  const elementTemplates: ReactElementTemplateFact[] = [];
  const classExpressionSites: ReactClassExpressionSiteFact[] = [];
  const renderStack: ReactRenderSiteFact[] = [];
  const componentStack: string[] = [];

  function visit(node: ts.Node): void {
    const componentKey = componentKeyByFunction.get(node);
    let componentRootSite: ReactRenderSiteFact | undefined;
    if (componentKey) {
      componentStack.push(componentKey);
      const component = components.find((candidate) => candidate.componentKey === componentKey);
      if (component) {
        componentRootSite = {
          siteKey: createSiteKey("component-root", component.location, component.componentKey),
          kind: "component-root",
          filePath: input.filePath,
          location: component.location,
          emittingComponentKey: component.componentKey,
          placementComponentKey: component.componentKey,
        };
        renderSites.push(componentRootSite);
        renderStack.push(componentRootSite);
      }
    }
    const currentComponentKey =
      componentStack.length > 0 ? componentStack[componentStack.length - 1] : undefined;
    const currentParentSiteKey =
      renderStack.length > 0 ? renderStack[renderStack.length - 1]?.siteKey : undefined;

    const renderSite = tryCreateRenderSite({
      node,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
      ...(currentComponentKey ? { emittingComponentKey: currentComponentKey } : {}),
      ...(currentParentSiteKey ? { parentSiteKey: currentParentSiteKey } : {}),
    });
    if (renderSite) {
      renderSites.push(renderSite);
      renderStack.push(renderSite);

      const template = tryCreateElementTemplate({
        node,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        renderSite,
      });
      if (template) {
        elementTemplates.push(template);
        renderSite.elementTemplateKey = template.templateKey;
      }

      const classSite = tryCreateJsxClassExpressionSite({
        node,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        ...(renderSite ? { renderSite } : {}),
        ...(template ? { template } : {}),
        ...(currentComponentKey ? { emittingComponentKey: currentComponentKey } : {}),
      });
      if (classSite) {
        classExpressionSites.push(classSite);
      }
    }

    const cssModuleClassSite = tryCreateCssModuleClassExpressionSite({
      node,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
      cssModuleNamespaceNames,
      ...(currentComponentKey ? { emittingComponentKey: currentComponentKey } : {}),
    });
    if (cssModuleClassSite) {
      classExpressionSites.push(cssModuleClassSite);
    }

    ts.forEachChild(node, visit);

    if (renderSite) {
      renderStack.pop();
    }
    if (componentRootSite) {
      renderStack.pop();
    }
    if (componentKey) {
      componentStack.pop();
    }
  }

  visit(input.sourceFile);

  return {
    components: components.sort(compareComponents),
    renderSites: renderSites.sort(compareRenderSites),
    elementTemplates: elementTemplates.sort(compareElementTemplates),
    classExpressionSites: dedupeClassExpressionSites(classExpressionSites).sort(
      compareClassExpressionSites,
    ),
  };
}

function tryCreateRenderSite(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  emittingComponentKey?: string;
  parentSiteKey?: string;
}): ReactRenderSiteFact | undefined {
  if (
    !ts.isJsxElement(input.node) &&
    !ts.isJsxSelfClosingElement(input.node) &&
    !ts.isJsxFragment(input.node) &&
    !ts.isConditionalExpression(input.node) &&
    !isHelperReturnStatement(input.node)
  ) {
    return undefined;
  }

  const location = toSourceAnchor(input.node, input.sourceFile, input.filePath);
  return {
    siteKey: createSiteKey(getRenderSiteKind(input.node), location, input.emittingComponentKey),
    kind: getRenderSiteKind(input.node),
    filePath: input.filePath,
    location,
    ...(input.emittingComponentKey
      ? {
          emittingComponentKey: input.emittingComponentKey,
          placementComponentKey: input.emittingComponentKey,
        }
      : {}),
    ...(input.parentSiteKey ? { parentSiteKey: input.parentSiteKey } : {}),
  };
}

function tryCreateElementTemplate(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  renderSite: ReactRenderSiteFact;
}): ReactElementTemplateFact | undefined {
  if (ts.isJsxFragment(input.node)) {
    return {
      templateKey: createSiteKey("element-template", input.renderSite.location, "fragment"),
      kind: "fragment",
      filePath: input.filePath,
      location: input.renderSite.location,
      name: "fragment",
      renderSiteKey: input.renderSite.siteKey,
      ...(input.renderSite.emittingComponentKey
        ? { emittingComponentKey: input.renderSite.emittingComponentKey }
        : {}),
      ...(input.renderSite.placementComponentKey
        ? { placementComponentKey: input.renderSite.placementComponentKey }
        : {}),
    };
  }

  const tagName = getJsxTagName(input.node);
  if (!tagName) {
    return undefined;
  }

  return {
    templateKey: createSiteKey("element-template", input.renderSite.location, tagName),
    kind: isIntrinsicTagName(tagName) ? "intrinsic" : "component-candidate",
    filePath: input.filePath,
    location: input.renderSite.location,
    name: tagName,
    renderSiteKey: input.renderSite.siteKey,
    ...(input.renderSite.emittingComponentKey
      ? { emittingComponentKey: input.renderSite.emittingComponentKey }
      : {}),
    ...(input.renderSite.placementComponentKey
      ? { placementComponentKey: input.renderSite.placementComponentKey }
      : {}),
  };
}

function tryCreateJsxClassExpressionSite(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  renderSite?: ReactRenderSiteFact;
  template?: ReactElementTemplateFact;
  emittingComponentKey?: string;
}): ReactClassExpressionSiteFact | undefined {
  if (!ts.isJsxElement(input.node) && !ts.isJsxSelfClosingElement(input.node)) {
    return undefined;
  }

  const attributes = ts.isJsxElement(input.node)
    ? input.node.openingElement.attributes.properties
    : input.node.attributes.properties;
  const classNameAttribute = attributes.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) && attribute.name.text === "className",
  );
  if (!classNameAttribute?.initializer) {
    return undefined;
  }

  const tagName = getJsxTagName(input.node) ?? "";
  const expression = unwrapJsxAttributeInitializer(classNameAttribute.initializer);
  const anchorNode = expression ?? classNameAttribute.initializer;
  const location = toSourceAnchor(anchorNode, input.sourceFile, input.filePath);
  const emittingComponentKey = input.renderSite?.emittingComponentKey ?? input.emittingComponentKey;
  const placementComponentKey = input.renderSite?.placementComponentKey ?? emittingComponentKey;
  return {
    siteKey: createSiteKey(
      "class-expression",
      location,
      input.renderSite?.siteKey ?? "standalone-jsx-class",
    ),
    kind: isIntrinsicTagName(tagName) ? "jsx-class" : "component-prop-class",
    filePath: input.filePath,
    location,
    rawExpressionText: anchorNode.getText(input.sourceFile),
    ...(emittingComponentKey ? { emittingComponentKey } : {}),
    ...(placementComponentKey ? { placementComponentKey } : {}),
    ...(input.renderSite ? { renderSiteKey: input.renderSite.siteKey } : {}),
    ...(input.template ? { elementTemplateKey: input.template.templateKey } : {}),
  };
}

function unwrapJsxAttributeInitializer(
  initializer: ts.JsxAttribute["initializer"],
): ts.Expression | undefined {
  if (!initializer) {
    return undefined;
  }

  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
    return initializer;
  }

  if (ts.isJsxExpression(initializer)) {
    return initializer.expression ?? undefined;
  }

  if (
    ts.isJsxElement(initializer) ||
    ts.isJsxSelfClosingElement(initializer) ||
    ts.isJsxFragment(initializer)
  ) {
    return initializer;
  }

  return undefined;
}

function tryCreateCssModuleClassExpressionSite(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  cssModuleNamespaceNames: ReadonlySet<string>;
  emittingComponentKey?: string;
}): ReactClassExpressionSiteFact | undefined {
  if (
    !ts.isPropertyAccessExpression(input.node) ||
    !ts.isIdentifier(input.node.expression) ||
    !input.cssModuleNamespaceNames.has(input.node.expression.text)
  ) {
    return undefined;
  }

  const location = toSourceAnchor(input.node, input.sourceFile, input.filePath);
  return {
    siteKey: createSiteKey("class-expression", location, "css-module-member"),
    kind: "css-module-member",
    filePath: input.filePath,
    location,
    rawExpressionText: input.node.getText(input.sourceFile),
    ...(input.emittingComponentKey
      ? {
          emittingComponentKey: input.emittingComponentKey,
          placementComponentKey: input.emittingComponentKey,
        }
      : {}),
  };
}

function collectCssModuleNamespaceNames(moduleSyntax: SourceModuleSyntaxFacts): Set<string> {
  const names = new Set<string>();
  for (const importRecord of moduleSyntax.imports) {
    if (importRecord.importKind !== "css" || !/\.module\.[cm]?css$/i.test(importRecord.specifier)) {
      continue;
    }

    for (const importName of importRecord.importNames) {
      if (importName.kind === "default" || importName.kind === "namespace") {
        names.add(importName.localName);
      }
    }
  }
  return names;
}

function getRenderSiteKind(node: ts.Node): ReactRenderSiteFact["kind"] {
  if (ts.isJsxFragment(node)) {
    return "jsx-fragment";
  }
  if (ts.isConditionalExpression(node)) {
    return "conditional";
  }
  if (isHelperReturnStatement(node)) {
    return "helper-return";
  }
  const tagName = getJsxTagName(node);
  if (tagName && !isIntrinsicTagName(tagName)) {
    return "component-reference";
  }
  return "jsx-element";
}

function getJsxTagName(node: ts.Node): string | undefined {
  if (ts.isJsxElement(node)) {
    return node.openingElement.tagName.getText(node.getSourceFile());
  }
  if (ts.isJsxSelfClosingElement(node)) {
    return node.tagName.getText(node.getSourceFile());
  }
  return undefined;
}

function isHelperReturnStatement(node: ts.Node): node is ts.ReturnStatement {
  return (
    ts.isReturnStatement(node) && Boolean(node.expression && isJsxLikeExpression(node.expression))
  );
}

function isJsxLikeExpression(expression: ts.Expression): boolean {
  return (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression) ||
    ts.isConditionalExpression(expression)
  );
}

function isIntrinsicTagName(tagName: string): boolean {
  return /^[a-z]/.test(tagName);
}

function createSiteKey(kind: string, location: SourceAnchor, discriminator?: string): string {
  return [
    kind,
    location.filePath.replace(/\\/g, "/"),
    location.startLine,
    location.startColumn,
    location.endLine ?? 0,
    location.endColumn ?? 0,
    discriminator ?? "",
  ].join(":");
}

function dedupeClassExpressionSites(
  sites: ReactClassExpressionSiteFact[],
): ReactClassExpressionSiteFact[] {
  const byKey = new Map<string, ReactClassExpressionSiteFact>();
  for (const site of sites) {
    byKey.set(site.siteKey, site);
  }
  return [...byKey.values()];
}

function compareComponents(
  left: ReactComponentDeclarationFact,
  right: ReactComponentDeclarationFact,
): number {
  return left.componentKey.localeCompare(right.componentKey);
}

function compareRenderSites(left: ReactRenderSiteFact, right: ReactRenderSiteFact): number {
  return left.siteKey.localeCompare(right.siteKey);
}

function compareElementTemplates(
  left: ReactElementTemplateFact,
  right: ReactElementTemplateFact,
): number {
  return left.templateKey.localeCompare(right.templateKey);
}

function compareClassExpressionSites(
  left: ReactClassExpressionSiteFact,
  right: ReactClassExpressionSiteFact,
): number {
  return left.siteKey.localeCompare(right.siteKey);
}
