import ts from "typescript";

import type { DestructuredPropBinding, SameFileComponentDefinition } from "../shared/types.js";
import { UNSUPPORTED_PARAMETER_BINDING_REASONS } from "../../shared/expansionSemantics.js";

export function summarizeParameterBinding(
  parameters: readonly ts.ParameterDeclaration[],
): SameFileComponentDefinition["parameterBinding"] {
  if (parameters.length === 0) {
    return { kind: "none" };
  }

  if (parameters.length > 1) {
    return {
      kind: "unsupported",
      reason: UNSUPPORTED_PARAMETER_BINDING_REASONS.multipleParameters,
    };
  }

  const [parameter] = parameters;
  if (ts.isIdentifier(parameter.name)) {
    return {
      kind: "props-identifier",
      identifierName: parameter.name.text,
    };
  }

  if (ts.isObjectBindingPattern(parameter.name)) {
    const properties: DestructuredPropBinding[] = [];

    for (const element of parameter.name.elements) {
      if (element.dotDotDotToken || !ts.isIdentifier(element.name)) {
        return {
          kind: "unsupported",
          reason: UNSUPPORTED_PARAMETER_BINDING_REASONS.unsupportedDestructuredBinding,
        };
      }

      const propertyNameNode = element.propertyName;
      if (
        propertyNameNode &&
        !ts.isIdentifier(propertyNameNode) &&
        !ts.isStringLiteral(propertyNameNode)
      ) {
        return {
          kind: "unsupported",
          reason: UNSUPPORTED_PARAMETER_BINDING_REASONS.unsupportedDestructuredPropertyName,
        };
      }

      if (element.initializer) {
        return {
          kind: "unsupported",
          reason: UNSUPPORTED_PARAMETER_BINDING_REASONS.destructuredDefaultValues,
        };
      }

      properties.push({
        propertyName: propertyNameNode?.text ?? element.name.text,
        identifierName: element.name.text,
      });
    }

    return {
      kind: "destructured-props",
      properties,
    };
  }

  return {
    kind: "unsupported",
    reason: UNSUPPORTED_PARAMETER_BINDING_REASONS.unsupportedParameterPattern,
  };
}
