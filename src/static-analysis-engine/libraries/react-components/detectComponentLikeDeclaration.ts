import ts from "typescript";

import type { ComponentLikeDefinition } from "./types.js";
import { detectReactWrapperComponent } from "./detectReactWrapperComponent.js";
import { getRenderableRootExpression } from "./isRenderableComponentBody.js";
import {
  findFunctionLikeAnchorNode,
  isClassComponentLike,
  isExported,
  toSourceAnchor,
  unwrapExpression,
} from "./reactComponentAstUtils.js";

export function detectComponentLikeDeclaration(input: {
  statement: ts.Statement;
  parsedSourceFile: ts.SourceFile;
  filePath: string;
  knownComponentNames: ReadonlySet<string>;
}): ComponentLikeDefinition[] {
  if (ts.isFunctionDeclaration(input.statement) && input.statement.name && input.statement.body) {
    return detectFunctionDeclarationComponent(input);
  }

  if (ts.isClassDeclaration(input.statement) && input.statement.name) {
    return detectClassDeclarationComponent(input);
  }

  if (ts.isVariableStatement(input.statement)) {
    return detectVariableDeclarationComponents(input);
  }

  return [];
}

function detectFunctionDeclarationComponent(input: {
  statement: ts.FunctionDeclaration;
  parsedSourceFile: ts.SourceFile;
  filePath: string;
}): ComponentLikeDefinition[] {
  if (!getRenderableRootExpression(input.statement.body!)) {
    return [];
  }

  return [
    {
      componentName: input.statement.name!.text,
      exported: isExported(input.statement),
      filePath: input.filePath,
      sourceAnchor: toSourceAnchor(input.statement.name!, input.parsedSourceFile, input.filePath),
      evidence: "renderable-function",
      declarationKind: "function",
      functionLikeNode: input.statement,
    },
  ];
}

function detectClassDeclarationComponent(input: {
  statement: ts.ClassDeclaration;
  parsedSourceFile: ts.SourceFile;
  filePath: string;
}): ComponentLikeDefinition[] {
  if (!isClassComponentLike(input.statement)) {
    return [];
  }

  return [
    {
      componentName: input.statement.name!.text,
      exported: isExported(input.statement),
      filePath: input.filePath,
      sourceAnchor: toSourceAnchor(input.statement.name!, input.parsedSourceFile, input.filePath),
      evidence: "class-component",
      declarationKind: "class",
    },
  ];
}

function detectVariableDeclarationComponents(input: {
  statement: ts.VariableStatement;
  parsedSourceFile: ts.SourceFile;
  filePath: string;
  knownComponentNames: ReadonlySet<string>;
}): ComponentLikeDefinition[] {
  const definitions: ComponentLikeDefinition[] = [];

  for (const declaration of input.statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      continue;
    }

    const directFunctionLike = getFunctionLikeComponentDefinition({
      localName: declaration.name.text,
      initializer: declaration.initializer,
      statement: input.statement,
      parsedSourceFile: input.parsedSourceFile,
      filePath: input.filePath,
    });
    if (directFunctionLike) {
      definitions.push(directFunctionLike);
      continue;
    }

    const wrapperDefinition = detectReactWrapperComponent({
      localName: declaration.name.text,
      initializer: declaration.initializer,
      statement: input.statement,
      parsedSourceFile: input.parsedSourceFile,
      filePath: input.filePath,
      knownComponentNames: input.knownComponentNames,
    });
    if (wrapperDefinition) {
      definitions.push(wrapperDefinition);
    }
  }

  return definitions;
}

function getFunctionLikeComponentDefinition(input: {
  localName: string;
  initializer: ts.Expression;
  statement: ts.VariableStatement;
  parsedSourceFile: ts.SourceFile;
  filePath: string;
}): ComponentLikeDefinition | undefined {
  const functionLikeNode = getFunctionLikeNode(input.initializer);
  if (!functionLikeNode || !getRenderableRootExpression(functionLikeNode.body)) {
    return undefined;
  }

  return {
    componentName: input.localName,
    exported: isExported(input.statement),
    filePath: input.filePath,
    sourceAnchor: toSourceAnchor(
      findFunctionLikeAnchorNode(functionLikeNode) ?? functionLikeNode,
      input.parsedSourceFile,
      input.filePath,
    ),
    evidence: "renderable-function",
    declarationKind: "variable",
    functionLikeNode,
  };
}

function getFunctionLikeNode(
  expression: ts.Expression,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  return ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)
    ? unwrapped
    : undefined;
}
