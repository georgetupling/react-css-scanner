import ts from "typescript";

import type { LocalHelperDefinition } from "../shared/types.js";
import { unwrapExpression } from "../shared/utils.js";
import { summarizeExpressionReturningBody } from "./summarizeExpressionReturningBody.js";

export function summarizeTopLevelHelperDefinition(input: {
  helperName: string;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  parameters: readonly ts.ParameterDeclaration[];
  body: ts.ConciseBody;
}): LocalHelperDefinition | undefined {
  return summarizeLocalHelperDefinition({
    helperName: input.helperName,
    filePath: input.filePath,
    parsedSourceFile: input.parsedSourceFile,
    parameters: input.parameters,
    body: input.body,
  });
}

export function summarizeFunctionExpressionHelperDefinition(
  helperName: string,
  filePath: string,
  parsedSourceFile: ts.SourceFile,
  initializer: ts.Expression,
): LocalHelperDefinition | undefined {
  const unwrapped = unwrapExpression(initializer);
  if (!ts.isArrowFunction(unwrapped) && !ts.isFunctionExpression(unwrapped)) {
    return undefined;
  }

  return summarizeLocalHelperDefinition({
    helperName,
    filePath,
    parsedSourceFile,
    parameters: unwrapped.parameters,
    body: unwrapped.body,
  });
}

export function summarizeLocalHelperDefinition(input: {
  helperName: string;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  parameters: readonly ts.ParameterDeclaration[];
  body: ts.ConciseBody;
}): LocalHelperDefinition | undefined {
  const parameterNames: string[] = [];
  for (const parameter of input.parameters) {
    if (!ts.isIdentifier(parameter.name)) {
      return undefined;
    }

    parameterNames.push(parameter.name.text);
  }

  const bodySummary = summarizeExpressionReturningBody(input.body);
  if (!bodySummary) {
    return undefined;
  }

  return {
    helperName: input.helperName,
    filePath: input.filePath,
    parsedSourceFile: input.parsedSourceFile,
    parameterNames,
    returnExpression: bodySummary.returnExpression,
    localExpressionBindings: bodySummary.localExpressionBindings,
  };
}
