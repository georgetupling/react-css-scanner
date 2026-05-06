import ts from "typescript";

import { toSourceAnchor } from "../../../../libraries/react-components/reactComponentAstUtils.js";
import { collectExpressionSyntaxForNode } from "../expression-syntax/index.js";
import { createSiteKey } from "./keys.js";
import type {
  ReactComponentPropBindingFact,
  ReactDestructuredBindingPropertyFact,
  ReactHelperDefinitionFact,
  ReactHelperParameterBindingFact,
  ReactLocalValueBindingFact,
  ReactUnsupportedBindingReason,
} from "./types.js";
import type { SourceExpressionSyntaxFact } from "../expression-syntax/index.js";

export type CollectedReactBindingFacts = {
  componentPropBindings: ReactComponentPropBindingFact[];
  localValueBindings: ReactLocalValueBindingFact[];
  helperDefinitions: ReactHelperDefinitionFact[];
  expressionSyntax: SourceExpressionSyntaxFact[];
};

export function collectComponentBindingFacts(input: {
  componentKey: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  functionLikeNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
}): CollectedReactBindingFacts {
  const collected = createEmptyCollectedBindingFacts();
  collected.componentPropBindings.push(
    collectComponentPropBinding({
      componentKey: input.componentKey,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
      parameters: input.functionLikeNode.parameters,
      locationNode: input.functionLikeNode,
      collected,
    }),
  );

  collectLocalBindingFactsFromBody({
    ownerKind: "component",
    ownerKey: input.componentKey,
    filePath: input.filePath,
    sourceFile: input.sourceFile,
    body: input.functionLikeNode.body,
    collected,
  });

  return collected;
}

export function collectTopLevelHelperBindingFacts(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  componentKeyByFunction: ReadonlyMap<ts.Node, string>;
}): CollectedReactBindingFacts {
  const collected = createEmptyCollectedBindingFacts();

  for (const statement of input.sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      if (
        input.componentKeyByFunction.has(statement) &&
        isLikelyReactComponentName(statement.name.text)
      ) {
        continue;
      }

      collectHelperDefinitionFromFunctionLike({
        helperName: statement.name.text,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        functionLikeNode: statement,
        definitionKind: "function-declaration",
        ownerKind: "source-file",
        ownerKey: input.filePath,
        collected,
      });
      continue;
    }

    if (!ts.isVariableStatement(statement) || !isConstDeclarationList(statement.declarationList)) {
      continue;
    }

    const scope = createLocalBindingScope({
      ownerKey: input.filePath,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
      node: input.sourceFile,
    });
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      const unwrapped = unwrapExpression(declaration.initializer);
      if (!ts.isArrowFunction(unwrapped) && !ts.isFunctionExpression(unwrapped)) {
        collectLocalBindingFactFromDeclaration({
          declaration,
          scope,
          ownerKind: "source-file",
          ownerKey: input.filePath,
          filePath: input.filePath,
          sourceFile: input.sourceFile,
          collected,
        });
        continue;
      }
      if (
        input.componentKeyByFunction.has(unwrapped) &&
        isLikelyReactComponentName(declaration.name.text)
      ) {
        continue;
      }

      collectHelperDefinitionFromFunctionLike({
        helperName: declaration.name.text,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        functionLikeNode: unwrapped,
        anchorNode: declaration.name,
        definitionKind: ts.isArrowFunction(unwrapped) ? "arrow-function" : "function-expression",
        ownerKind: "source-file",
        ownerKey: input.filePath,
        collected,
      });
    }
  }

  return collected;
}

export function isLikelyReactComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

export function mergeReactBindingFacts(
  entries: CollectedReactBindingFacts[],
): CollectedReactBindingFacts {
  return {
    componentPropBindings: dedupeByKey(
      entries.flatMap((entry) => entry.componentPropBindings),
      (entry) => entry.bindingKey,
    ),
    localValueBindings: dedupeByKey(
      entries.flatMap((entry) => entry.localValueBindings),
      (entry) => entry.bindingKey,
    ),
    helperDefinitions: dedupeByKey(
      entries.flatMap((entry) => entry.helperDefinitions),
      (entry) => entry.helperKey,
    ),
    expressionSyntax: dedupeByKey(
      entries.flatMap((entry) => entry.expressionSyntax),
      (entry) => entry.expressionId,
    ),
  };
}

function collectComponentPropBinding(input: {
  componentKey: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  parameters: readonly ts.ParameterDeclaration[];
  locationNode: ts.Node;
  collected: CollectedReactBindingFacts;
}): ReactComponentPropBindingFact {
  const location = toSourceAnchor(input.locationNode, input.sourceFile, input.filePath);
  const bindingKey = createSiteKey("component-prop-binding", location, input.componentKey);

  if (input.parameters.length === 0) {
    return {
      bindingKey,
      componentKey: input.componentKey,
      filePath: input.filePath,
      location,
      bindingKind: "none",
      properties: [],
    };
  }

  if (input.parameters.length > 1) {
    return buildUnsupportedComponentPropBinding({
      ...input,
      location,
      bindingKey,
      unsupportedReason: "multiple-parameters",
    });
  }

  const [parameter] = input.parameters;
  if (ts.isIdentifier(parameter.name)) {
    return {
      bindingKey,
      componentKey: input.componentKey,
      filePath: input.filePath,
      location: toSourceAnchor(parameter.name, input.sourceFile, input.filePath),
      bindingKind: "props-identifier",
      identifierName: parameter.name.text,
      properties: [],
    };
  }

  if (ts.isObjectBindingPattern(parameter.name)) {
    const properties = collectDestructuredBindingProperties({
      pattern: parameter.name,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
      collected: input.collected,
    });
    if (!properties) {
      return buildUnsupportedComponentPropBinding({
        ...input,
        location,
        bindingKey,
        unsupportedReason: "unsupported-destructured-props",
      });
    }

    return {
      bindingKey,
      componentKey: input.componentKey,
      filePath: input.filePath,
      location: toSourceAnchor(parameter.name, input.sourceFile, input.filePath),
      bindingKind: "destructured-props",
      properties,
    };
  }

  return buildUnsupportedComponentPropBinding({
    ...input,
    location,
    bindingKey,
    unsupportedReason: "unsupported-parameter-pattern",
  });
}

function buildUnsupportedComponentPropBinding(input: {
  componentKey: string;
  filePath: string;
  location: ReturnType<typeof toSourceAnchor>;
  bindingKey: string;
  unsupportedReason: ReactUnsupportedBindingReason;
}): ReactComponentPropBindingFact {
  return {
    bindingKey: input.bindingKey,
    componentKey: input.componentKey,
    filePath: input.filePath,
    location: input.location,
    bindingKind: "unsupported",
    properties: [],
    unsupportedReason: input.unsupportedReason,
  };
}

function collectLocalBindingFactsFromBody(input: {
  ownerKind: "component" | "helper";
  ownerKey: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  body: ts.ConciseBody | undefined;
  collected: CollectedReactBindingFacts;
}): void {
  if (!input.body || !ts.isBlock(input.body)) {
    return;
  }

  const scope = createLocalBindingScope({
    ownerKey: input.ownerKey,
    filePath: input.filePath,
    sourceFile: input.sourceFile,
    node: input.body,
  });
  collectLocalBindingFactsFromStatements({
    ...input,
    statements: input.body.statements,
    scope,
  });
}

function collectLocalBindingFactsFromStatements(input: {
  ownerKind: "component" | "helper";
  ownerKey: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  statements: readonly ts.Statement[];
  scope: LocalBindingScope;
  collected: CollectedReactBindingFacts;
}): void {
  for (const statement of input.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      collectHelperDefinitionFromFunctionLike({
        helperName: statement.name.text,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        functionLikeNode: statement,
        definitionKind: "function-declaration",
        ownerKind: input.ownerKind,
        ownerKey: input.ownerKey,
        collected: input.collected,
      });
      continue;
    }

    if (!ts.isVariableStatement(statement) || !isConstDeclarationList(statement.declarationList)) {
      collectLocalBindingFactsFromNestedCallbacks({
        ...input,
        node: statement,
      });
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      collectLocalBindingFactFromDeclaration({
        declaration,
        scope: input.scope,
        ownerKind: input.ownerKind,
        ownerKey: input.ownerKey,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        collected: input.collected,
      });
    }
    collectLocalBindingFactsFromNestedCallbacks({
      ...input,
      node: statement,
    });
  }
}

function collectLocalBindingFactFromDeclaration(input: {
  declaration: ts.VariableDeclaration;
  scope: LocalBindingScope;
  ownerKind: "source-file" | "component" | "helper";
  ownerKey: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  collected: CollectedReactBindingFacts;
}): void {
  if (!input.declaration.initializer) {
    return;
  }

  if (ts.isIdentifier(input.declaration.name)) {
    const unwrapped = unwrapExpression(input.declaration.initializer);
    if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
      collectHelperDefinitionFromFunctionLike({
        helperName: input.declaration.name.text,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        functionLikeNode: unwrapped,
        anchorNode: input.declaration.name,
        definitionKind: ts.isArrowFunction(unwrapped) ? "arrow-function" : "function-expression",
        ownerKind: input.ownerKind,
        ownerKey: input.ownerKey,
        collected: input.collected,
      });
      return;
    }

    const expression = collectExpressionSyntaxForNode({
      node: input.declaration.initializer,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
    });
    input.collected.expressionSyntax.push(...expression.expressions);
    const location = toSourceAnchor(input.declaration.name, input.sourceFile, input.filePath);
    input.collected.localValueBindings.push({
      bindingKey: createSiteKey(
        "local-value-binding",
        location,
        `${input.scope.scopeKey}:${input.declaration.name.text}`,
      ),
      ownerKind: input.ownerKind,
      ownerKey: input.ownerKey,
      filePath: input.filePath,
      scopeKey: input.scope.scopeKey,
      scopeLocation: input.scope.scopeLocation,
      localName: input.declaration.name.text,
      location,
      bindingKind: "const-identifier",
      expressionId: expression.rootExpressionId,
    });
    return;
  }

  if (!ts.isObjectBindingPattern(input.declaration.name)) {
    return;
  }

  const objectExpression = collectExpressionSyntaxForNode({
    node: input.declaration.initializer,
    filePath: input.filePath,
    sourceFile: input.sourceFile,
  });
  input.collected.expressionSyntax.push(...objectExpression.expressions);

  for (const element of input.declaration.name.elements) {
    if (element.dotDotDotToken || !ts.isIdentifier(element.name)) {
      continue;
    }

    const propertyName = getBindingElementPropertyName(element);
    if (!propertyName) {
      continue;
    }

    const initializerExpression = element.initializer
      ? collectExpressionSyntaxForNode({
          node: element.initializer,
          filePath: input.filePath,
          sourceFile: input.sourceFile,
        })
      : undefined;
    if (initializerExpression) {
      input.collected.expressionSyntax.push(...initializerExpression.expressions);
    }

    const location = toSourceAnchor(element.name, input.sourceFile, input.filePath);
    input.collected.localValueBindings.push({
      bindingKey: createSiteKey(
        "local-value-binding",
        location,
        `${input.scope.scopeKey}:${element.name.text}`,
      ),
      ownerKind: input.ownerKind,
      ownerKey: input.ownerKey,
      filePath: input.filePath,
      scopeKey: input.scope.scopeKey,
      scopeLocation: input.scope.scopeLocation,
      localName: element.name.text,
      location,
      bindingKind: "destructured-property",
      objectExpressionId: objectExpression.rootExpressionId,
      propertyName,
      ...(initializerExpression
        ? { initializerExpressionId: initializerExpression.rootExpressionId }
        : {}),
    });
  }
}

function collectHelperDefinitionFromFunctionLike(input: {
  helperName: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  functionLikeNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
  anchorNode?: ts.Node;
  definitionKind: ReactHelperDefinitionFact["definitionKind"];
  ownerKind: ReactHelperDefinitionFact["ownerKind"];
  ownerKey: string;
  collected: CollectedReactBindingFacts;
}): void {
  const anchorNode = input.anchorNode ?? input.functionLikeNode.name ?? input.functionLikeNode;
  const location = toSourceAnchor(anchorNode, input.sourceFile, input.filePath);
  const helperKey = createSiteKey(
    "helper-definition",
    location,
    `${input.ownerKind}:${input.ownerKey}:${input.helperName}`,
  );
  const returnExpression = getSimpleReturnExpression(input.functionLikeNode.body);
  const returnExpressions = collectBoundedReturnExpressions(input.functionLikeNode.body);
  const returnExpressionSyntaxes = returnExpressions.map((node) =>
    collectExpressionSyntaxForNode({
      node,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
    }),
  );
  for (const syntax of returnExpressionSyntaxes) {
    input.collected.expressionSyntax.push(...syntax.expressions);
  }
  const singleReturnExpressionSyntax =
    returnExpression && returnExpressionSyntaxes.length > 0
      ? returnExpressionSyntaxes.find((syntax) => syntax.rootExpressionId)
      : undefined;

  input.collected.helperDefinitions.push({
    helperKey,
    helperName: input.helperName,
    filePath: input.filePath,
    location,
    ownerKind: input.ownerKind,
    ownerKey: input.ownerKey,
    definitionKind: input.definitionKind,
    parameters: input.functionLikeNode.parameters.map((parameter) =>
      collectHelperParameterBinding({
        parameter,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        collected: input.collected,
      }),
    ),
    ...(getRestParameterName(input.functionLikeNode.parameters)
      ? { restParameterName: getRestParameterName(input.functionLikeNode.parameters) }
      : {}),
    ...(() => {
      const collectedReturnExpressionIds = returnExpressionSyntaxes
        .map((syntax) => syntax.rootExpressionId)
        .filter((id): id is string => Boolean(id));
      if (collectedReturnExpressionIds.length === 0) {
        return {};
      }
      return {
        returnExpressionId:
          singleReturnExpressionSyntax?.rootExpressionId ?? collectedReturnExpressionIds[0],
        ...(collectedReturnExpressionIds.length > 1
          ? { returnExpressionIds: collectedReturnExpressionIds }
          : {}),
      };
    })(),
    ...(!singleReturnExpressionSyntax && returnExpressionSyntaxes.length === 0
      ? { unsupportedReason: "unsupported-helper-return" }
      : {}),
  });

  collectLocalBindingFactsFromBody({
    ownerKind: "helper",
    ownerKey: helperKey,
    filePath: input.filePath,
    sourceFile: input.sourceFile,
    body: input.functionLikeNode.body,
    collected: input.collected,
  });
}

function collectHelperParameterBinding(input: {
  parameter: ts.ParameterDeclaration;
  filePath: string;
  sourceFile: ts.SourceFile;
  collected: CollectedReactBindingFacts;
}): ReactHelperParameterBindingFact {
  const location = toSourceAnchor(input.parameter.name, input.sourceFile, input.filePath);

  if (input.parameter.dotDotDotToken && ts.isIdentifier(input.parameter.name)) {
    return {
      parameterKind: "rest",
      localName: input.parameter.name.text,
      location,
    };
  }

  if (ts.isIdentifier(input.parameter.name)) {
    return {
      parameterKind: "identifier",
      localName: input.parameter.name.text,
      location,
    };
  }

  if (ts.isObjectBindingPattern(input.parameter.name)) {
    const properties = collectDestructuredBindingProperties({
      pattern: input.parameter.name,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
      collected: input.collected,
    });
    if (properties) {
      return {
        parameterKind: "destructured-object",
        location,
        properties,
      };
    }
  }

  return {
    parameterKind: "unsupported",
    location,
    unsupportedReason: "unsupported-parameter-pattern",
  };
}

type LocalBindingScope = {
  scopeKey: string;
  scopeLocation: ReturnType<typeof toSourceAnchor>;
};

function createLocalBindingScope(input: {
  ownerKey: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  node: ts.Node;
}): LocalBindingScope {
  const scopeLocation = toSourceAnchor(input.node, input.sourceFile, input.filePath);
  return {
    scopeKey: createSiteKey("local-scope", scopeLocation, input.ownerKey),
    scopeLocation,
  };
}

function collectLocalBindingFactsFromNestedCallbacks(input: {
  ownerKind: "component" | "helper";
  ownerKey: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  node: ts.Node;
  scope: LocalBindingScope;
  collected: CollectedReactBindingFacts;
}): void {
  const visit = (node: ts.Node): void => {
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isBlock(node.body)) {
      const callbackScope = createLocalBindingScope({
        ownerKey: input.ownerKey,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        node: node.body,
      });
      collectLocalBindingFactsFromStatements({
        ownerKind: input.ownerKind,
        ownerKey: input.ownerKey,
        filePath: input.filePath,
        sourceFile: input.sourceFile,
        statements: node.body.statements,
        scope: callbackScope,
        collected: input.collected,
      });
      return;
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(input.node, visit);
}

function collectDestructuredBindingProperties(input: {
  pattern: ts.ObjectBindingPattern;
  filePath: string;
  sourceFile: ts.SourceFile;
  collected: CollectedReactBindingFacts;
}): ReactDestructuredBindingPropertyFact[] | undefined {
  const properties: ReactDestructuredBindingPropertyFact[] = [];

  for (const element of input.pattern.elements) {
    if (element.dotDotDotToken) {
      continue;
    }

    if (!ts.isIdentifier(element.name)) {
      return undefined;
    }

    const propertyName = getBindingElementPropertyName(element);
    if (!propertyName) {
      return undefined;
    }

    const initializerExpression = element.initializer
      ? collectExpressionSyntaxForNode({
          node: element.initializer,
          filePath: input.filePath,
          sourceFile: input.sourceFile,
        })
      : undefined;
    if (initializerExpression) {
      input.collected.expressionSyntax.push(...initializerExpression.expressions);
    }

    properties.push({
      propertyName,
      localName: element.name.text,
      location: toSourceAnchor(element.name, input.sourceFile, input.filePath),
      ...(initializerExpression
        ? { initializerExpressionId: initializerExpression.rootExpressionId }
        : {}),
    });
  }

  return properties;
}

function getBindingElementPropertyName(element: ts.BindingElement): string | undefined {
  if (!element.propertyName) {
    return element.name.getText(element.getSourceFile());
  }

  if (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)) {
    return element.propertyName.text;
  }

  return undefined;
}

function getSimpleReturnExpression(body: ts.ConciseBody | undefined): ts.Expression | undefined {
  if (!body) {
    return undefined;
  }

  if (!ts.isBlock(body)) {
    return body;
  }

  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return statement.expression;
    }
  }

  return undefined;
}

function collectBoundedReturnExpressions(body: ts.ConciseBody | undefined): ts.Expression[] {
  if (!body) {
    return [];
  }

  if (!ts.isBlock(body)) {
    return [body];
  }

  const expressions: ts.Expression[] = [];
  const visitStatement = (statement: ts.Statement): void => {
    if (ts.isReturnStatement(statement)) {
      if (statement.expression) {
        expressions.push(statement.expression);
      }
      return;
    }

    if (ts.isBlock(statement)) {
      for (const child of statement.statements) {
        visitStatement(child);
      }
      return;
    }

    if (ts.isIfStatement(statement)) {
      visitStatement(statement.thenStatement);
      if (statement.elseStatement) {
        visitStatement(statement.elseStatement);
      }
      return;
    }

    if (ts.isSwitchStatement(statement)) {
      for (const clause of statement.caseBlock.clauses) {
        for (const child of clause.statements) {
          visitStatement(child);
        }
      }
    }
  };

  for (const statement of body.statements) {
    visitStatement(statement);
  }

  return expressions;
}

function getRestParameterName(parameters: readonly ts.ParameterDeclaration[]): string | undefined {
  const restParameter = parameters.find(
    (parameter) => parameter.dotDotDotToken && ts.isIdentifier(parameter.name),
  );
  return restParameter && ts.isIdentifier(restParameter.name) ? restParameter.name.text : undefined;
}

function isConstDeclarationList(declarationList: ts.VariableDeclarationList): boolean {
  return (declarationList.flags & ts.NodeFlags.Const) !== 0;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function createEmptyCollectedBindingFacts(): CollectedReactBindingFacts {
  return {
    componentPropBindings: [],
    localValueBindings: [],
    helperDefinitions: [],
    expressionSyntax: [],
  };
}

function dedupeByKey<T>(values: T[], getKey: (value: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) {
    byKey.set(getKey(value), value);
  }

  return [...byKey.values()].sort((left, right) => getKey(left).localeCompare(getKey(right)));
}
