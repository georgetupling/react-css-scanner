import ts from "typescript";

import type { DestructuredPropBinding, SameFileComponentDefinition } from "../shared/types.js";
import { UNSUPPORTED_PARAMETER_BINDING_REASONS } from "../../shared/expansionSemantics.js";
import {
  collectFiniteStringValuesByProperty,
  type FiniteTypeEvidenceCache,
} from "../shared/finiteTypeEvidence.js";

export function summarizeParameterBinding(
  parameters: readonly ts.ParameterDeclaration[],
  finiteTypeEvidenceCache?: FiniteTypeEvidenceCache,
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
  const finiteStringValuesByProperty = collectFiniteStringValuesByProperty(
    parameter,
    finiteTypeEvidenceCache,
  );
  if (ts.isIdentifier(parameter.name)) {
    return {
      kind: "props-identifier",
      identifierName: parameter.name.text,
      ...(finiteStringValuesByProperty.size > 0 ? { finiteStringValuesByProperty } : {}),
    };
  }

  if (ts.isObjectBindingPattern(parameter.name)) {
    const properties: DestructuredPropBinding[] = [];

    for (const element of parameter.name.elements) {
      if (element.dotDotDotToken) {
        if (ts.isIdentifier(element.name)) {
          continue;
        }

        return {
          kind: "unsupported",
          reason: UNSUPPORTED_PARAMETER_BINDING_REASONS.unsupportedDestructuredBinding,
        };
      }

      if (!ts.isIdentifier(element.name)) {
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
