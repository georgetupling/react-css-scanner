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
    return detectFunctionDeclarationComponent({
      statement: input.statement as ts.FunctionDeclaration & { body: ts.Block },
      parsedSourceFile: input.parsedSourceFile,
      filePath: input.filePath,
    });
  }

  if (ts.isClassDeclaration(input.statement) && input.statement.name) {
    return detectClassDeclarationComponent({
      statement: input.statement,
      parsedSourceFile: input.parsedSourceFile,
      filePath: input.filePath,
    });
  }

  if (ts.isVariableStatement(input.statement)) {
    return detectVariableDeclarationComponents({
      statement: input.statement,
      parsedSourceFile: input.parsedSourceFile,
      filePath: input.filePath,
      knownComponentNames: input.knownComponentNames,
    });
  }

  return [];
}

function detectFunctionDeclarationComponent(input: {
  statement: ts.FunctionDeclaration & { body: ts.Block };
  parsedSourceFile: ts.SourceFile;
  filePath: string;
}): ComponentLikeDefinition[] {
  if (!getRenderableRootExpression(input.statement.body)) {
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

  const renderMethodNode = getClassRenderMethod(input.statement);

  return [
    {
      componentName: input.statement.name!.text,
      exported: isExported(input.statement),
      filePath: input.filePath,
      sourceAnchor: toSourceAnchor(input.statement.name!, input.parsedSourceFile, input.filePath),
      evidence: "class-component",
      declarationKind: "class",
      ...(renderMethodNode ? { renderMethodNode } : {}),
    },
  ];
}

function getClassRenderMethod(
  declaration: ts.ClassDeclaration,
): (ts.MethodDeclaration & { body: ts.Block }) | undefined {
  for (const member of declaration.members) {
    if (
      ts.isMethodDeclaration(member) &&
      member.name &&
      ts.isIdentifier(member.name) &&
      member.name.text === "render" &&
      member.body
    ) {
      return member as ts.MethodDeclaration & { body: ts.Block };
    }
  }

  return undefined;
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
