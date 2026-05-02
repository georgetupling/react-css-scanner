import ts from "typescript";

import { collectComponentLikeDefinitions } from "../../../../libraries/react-components/index.js";
import { createComponentKey } from "./componentIdentity.js";
import type { ReactComponentDeclarationFact } from "./types.js";

export function collectReactComponents(input: { filePath: string; sourceFile: ts.SourceFile }): {
  components: ReactComponentDeclarationFact[];
  componentKeyByFunction: Map<ts.Node, string>;
} {
  const definitions = collectComponentLikeDefinitions({
    filePath: input.filePath,
    parsedSourceFile: input.sourceFile,
  });
  const componentKeyByFunction = new Map<ts.Node, string>();
  const components = definitions.map((definition): ReactComponentDeclarationFact => {
    const componentKey = createComponentKey({
      filePath: input.filePath,
      sourceAnchor: definition.sourceAnchor,
      componentName: definition.componentName,
    });

    if (definition.functionLikeNode) {
      componentKeyByFunction.set(definition.functionLikeNode, componentKey);
    }
    if (definition.renderMethodNode) {
      componentKeyByFunction.set(definition.renderMethodNode, componentKey);
    }

    const renderedPropNames = definition.functionLikeNode
      ? collectRenderedPropNames(definition.functionLikeNode)
      : definition.renderMethodNode
        ? collectRenderedPropNames(definition.renderMethodNode)
        : [];

    return {
      componentKey,
      componentName: definition.componentName,
      filePath: input.filePath,
      exported: definition.exported,
      declarationKind: definition.declarationKind,
      evidence: definition.evidence,
      location: definition.sourceAnchor,
      ...(renderedPropNames.includes("children") ? { rendersChildrenProp: true } : {}),
      ...(renderedPropNames.length > 0 ? { renderedPropNames } : {}),
    };
  });

  return { components, componentKeyByFunction };
}

type PropBinding = {
  localNamesByPropName: Map<string, Set<string>>;
  propsIdentifier?: string;
};

function collectRenderedPropNames(
  functionLikeNode:
    | ts.FunctionDeclaration
    | ts.ArrowFunction
    | ts.FunctionExpression
    | (ts.MethodDeclaration & { body: ts.Block }),
): string[] {
  const binding = getPropBinding(functionLikeNode);
  if (!binding || (binding.localNamesByPropName.size === 0 && !binding.propsIdentifier)) {
    return [];
  }

  const renderedPropNames = new Set<string>();
  const rootBody = functionLikeNode.body;
  if (!rootBody) {
    return [];
  }

  const visit = (node: ts.Node, shadowedNames: ReadonlySet<string>): void => {
    if (isNestedFunctionLike(node, functionLikeNode)) {
      const nestedShadowedNames = collectNestedShadowNames(node, binding, shadowedNames);
      if (node.body) {
        visit(node.body, nestedShadowedNames);
      }
      return;
    }

    const propName = getReferencedPropName({ node, binding, shadowedNames });
    if (propName && isRenderPropConsumption({ node, propName, rootBody })) {
      renderedPropNames.add(propName);
    }

    ts.forEachChild(node, (child) => visit(child, shadowedNames));
  };

  visit(rootBody, new Set());
  return [...renderedPropNames].sort((left, right) => left.localeCompare(right));
}

function getPropBinding(
  functionLikeNode:
    | ts.FunctionDeclaration
    | ts.ArrowFunction
    | ts.FunctionExpression
    | (ts.MethodDeclaration & { body: ts.Block }),
): PropBinding | undefined {
  const [propsParameter] = functionLikeNode.parameters;
  if (!propsParameter) {
    return undefined;
  }

  if (ts.isIdentifier(propsParameter.name)) {
    return {
      localNamesByPropName: new Map(),
      propsIdentifier: propsParameter.name.text,
    };
  }

  if (!ts.isObjectBindingPattern(propsParameter.name)) {
    return undefined;
  }

  const localNamesByPropName = new Map<string, Set<string>>();
  for (const element of propsParameter.name.elements) {
    if (!ts.isBindingElement(element)) {
      continue;
    }
    const propertyName = getBindingElementPropertyName(element);
    const propName =
      propertyName ?? (ts.isIdentifier(element.name) ? element.name.text : undefined);
    if (!propName) {
      continue;
    }
    const localNames = localNamesByPropName.get(propName) ?? new Set<string>();
    for (const name of collectBindingNames(element.name)) {
      localNames.add(name);
    }
    localNamesByPropName.set(propName, localNames);
  }

  return { localNamesByPropName };
}

function getBindingElementPropertyName(element: ts.BindingElement): string | undefined {
  if (!element.propertyName) {
    return undefined;
  }
  if (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)) {
    return element.propertyName.text;
  }
  return undefined;
}

function collectBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }

  const names: string[] = [];
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      names.push(...collectBindingNames(element.name));
    }
  }
  return names;
}

function isNestedFunctionLike(
  node: ts.Node,
  root:
    | ts.FunctionDeclaration
    | ts.ArrowFunction
    | ts.FunctionExpression
    | (ts.MethodDeclaration & { body: ts.Block }),
): node is ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression {
  return (
    node !== root &&
    (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
  );
}

function collectNestedShadowNames(
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  binding: PropBinding,
  inherited: ReadonlySet<string>,
): ReadonlySet<string> {
  const shadowedNames = new Set(inherited);
  const addIfRelevant = (name: string): void => {
    const isBoundLocalName = [...binding.localNamesByPropName.values()].some((localNames) =>
      localNames.has(name),
    );
    if (isBoundLocalName || binding.propsIdentifier === name) {
      shadowedNames.add(name);
    }
  };

  if (node.name) {
    addIfRelevant(node.name.text);
  }
  for (const parameter of node.parameters) {
    for (const name of collectBindingNames(parameter.name)) {
      addIfRelevant(name);
    }
  }

  if (node.body) {
    collectDeclaredBindingNames(node.body, addIfRelevant);
  }

  return shadowedNames;
}

function collectDeclaredBindingNames(node: ts.Node, addName: (name: string) => void): void {
  const visit = (current: ts.Node): void => {
    if (ts.isVariableDeclaration(current)) {
      for (const name of collectBindingNames(current.name)) {
        addName(name);
      }
      return;
    }
    if (ts.isFunctionDeclaration(current) && current.name) {
      addName(current.name.text);
      return;
    }
    if (ts.isClassDeclaration(current) && current.name) {
      addName(current.name.text);
      return;
    }
    if (
      current !== node &&
      (ts.isFunctionDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current))
    ) {
      return;
    }
    ts.forEachChild(current, visit);
  };

  ts.forEachChild(node, visit);
}

function getReferencedPropName(input: {
  node: ts.Node;
  binding: PropBinding;
  shadowedNames: ReadonlySet<string>;
}): string | undefined {
  if (ts.isPropertyAccessExpression(input.node)) {
    if (
      ts.isIdentifier(input.node.expression) &&
      input.binding.propsIdentifier === input.node.expression.text &&
      !input.shadowedNames.has(input.node.expression.text)
    ) {
      return input.node.name.text;
    }
    return undefined;
  }

  if (
    !ts.isIdentifier(input.node) ||
    input.shadowedNames.has(input.node.text) ||
    isIdentifierInNonReferencePosition(input.node)
  ) {
    return undefined;
  }

  for (const [propName, localNames] of input.binding.localNamesByPropName.entries()) {
    if (localNames.has(input.node.text)) {
      return propName;
    }
  }

  return undefined;
}

function isIdentifierInNonReferencePosition(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isBindingElement(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isFunctionDeclaration(parent) && parent.name === identifier) ||
    (ts.isFunctionExpression(parent) && parent.name === identifier) ||
    (ts.isClassDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier)
  );
}

function isRenderPropConsumption(input: {
  node: ts.Node;
  propName: string;
  rootBody: ts.ConciseBody;
}): boolean {
  if (input.propName === "children" && isDirectChildrenRenderPropCall(input.node)) {
    return true;
  }
  if (isWithinKnownChildrenRenderCall(input.node)) {
    return true;
  }
  if (isWithinJsxChildExpression(input.node)) {
    return true;
  }
  if (isWithinReturnedExpression(input.node, input.rootBody)) {
    return true;
  }
  return false;
}

function isDirectChildrenRenderPropCall(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isCallExpression(parent) && parent.expression === node;
}

function isWithinJsxChildExpression(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxExpression(current)) {
      return Boolean(
        current.parent && (ts.isJsxElement(current.parent) || ts.isJsxFragment(current.parent)),
      );
    }
    current = current.parent;
  }
  return false;
}

function isWithinKnownChildrenRenderCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isCallExpression(current) &&
      isKnownChildrenRenderCall(current) &&
      current.arguments[0] &&
      isNodeWithin(node, current.arguments[0])
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isKnownChildrenRenderCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }
  if (!["map", "only", "toArray"].includes(callee.name.text)) {
    return false;
  }

  const owner = callee.expression;
  if (ts.isIdentifier(owner)) {
    return owner.text === "Children";
  }
  return (
    ts.isPropertyAccessExpression(owner) &&
    owner.name.text === "Children" &&
    ts.isIdentifier(owner.expression) &&
    owner.expression.text === "React"
  );
}

function isWithinReturnedExpression(node: ts.Node, rootBody: ts.ConciseBody): boolean {
  if (!ts.isBlock(rootBody)) {
    return isNodeWithin(node, rootBody);
  }

  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isReturnStatement(current)) {
      return Boolean(current.expression && isNodeWithin(node, current.expression));
    }
    current = current.parent;
  }
  return false;
}

function isNodeWithin(node: ts.Node, ancestor: ts.Node): boolean {
  return node.pos >= ancestor.pos && node.end <= ancestor.end;
}
