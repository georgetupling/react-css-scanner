import ts from "typescript";

import type {
  DestructuredPropBinding,
  HelperParameterBinding,
  LocalHelperDefinition,
} from "../shared/types.js";
import { collectFiniteStringValuesByProperty } from "../shared/finiteTypeEvidence.js";
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
  const parameterBindings: HelperParameterBinding[] = [];
  let restParameterName: string | undefined;
  for (let index = 0; index < input.parameters.length; index += 1) {
    const parameter = input.parameters[index];
    if (parameter.dotDotDotToken) {
      if (!ts.isIdentifier(parameter.name)) {
        return undefined;
      }

      if (index !== input.parameters.length - 1 || restParameterName) {
        return undefined;
      }

      restParameterName = parameter.name.text;
      continue;
    }

    if (ts.isIdentifier(parameter.name)) {
      const finiteStringValuesByProperty = collectFiniteStringValuesByProperty(parameter);
      parameterNames.push(parameter.name.text);
      parameterBindings.push({
        kind: "identifier",
        identifierName: parameter.name.text,
        ...(finiteStringValuesByProperty.size > 0 ? { finiteStringValuesByProperty } : {}),
      });
      continue;
    }

    if (ts.isObjectBindingPattern(parameter.name)) {
      const properties = collectDestructuredHelperProperties(parameter);
      if (!properties) {
        return undefined;
      }

      parameterBindings.push({ kind: "destructured-object", properties });
      continue;
    }

    return undefined;
  }

  const bodySummary = summarizeExpressionReturningBody(
    input.body,
    buildFiniteStringValuesByObjectName(parameterBindings),
  );
  if (!bodySummary) {
    return undefined;
  }

  return {
    helperName: input.helperName,
    filePath: input.filePath,
    parsedSourceFile: input.parsedSourceFile,
    parameterNames,
    parameterBindings,
    restParameterName,
    returnExpression: bodySummary.returnExpression,
    localExpressionBindings: bodySummary.localExpressionBindings,
    localStringSetBindings: bodySummary.localStringSetBindings,
  };
}

function collectDestructuredHelperProperties(
  parameter: ts.ParameterDeclaration,
): DestructuredPropBinding[] | undefined {
  const finiteStringValuesByProperty = collectFiniteStringValuesByProperty(parameter);
  const properties: DestructuredPropBinding[] = [];

  if (!ts.isObjectBindingPattern(parameter.name)) {
    return undefined;
  }

  for (const element of parameter.name.elements) {
    if (element.dotDotDotToken || !ts.isIdentifier(element.name)) {
      return undefined;
    }

    const propertyNameNode = element.propertyName;
    if (
      propertyNameNode &&
      !ts.isIdentifier(propertyNameNode) &&
      !ts.isStringLiteral(propertyNameNode)
    ) {
      return undefined;
    }

    const propertyName = propertyNameNode?.text ?? element.name.text;
    properties.push({
      propertyName,
      identifierName: element.name.text,
      ...(element.initializer ? { initializer: element.initializer } : {}),
      ...(finiteStringValuesByProperty.has(propertyName)
        ? { finiteStringValues: finiteStringValuesByProperty.get(propertyName) }
        : {}),
    });
  }

  return properties;
}

function buildFiniteStringValuesByObjectName(
  parameterBindings: HelperParameterBinding[],
): Map<string, Map<string, string[]>> {
  const valuesByObjectName = new Map<string, Map<string, string[]>>();
  for (const parameterBinding of parameterBindings) {
    if (parameterBinding.kind === "identifier" && parameterBinding.finiteStringValuesByProperty) {
      valuesByObjectName.set(
        parameterBinding.identifierName,
        parameterBinding.finiteStringValuesByProperty,
      );
    }
  }

  return valuesByObjectName;
}
