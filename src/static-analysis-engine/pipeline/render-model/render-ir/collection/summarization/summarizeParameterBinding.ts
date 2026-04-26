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
  const finiteStringValuesByProperty = ts.isObjectBindingPattern(parameter.name)
    ? collectFiniteStringValuesByProperty(parameter)
    : new Map<string, string[]>();
  if (ts.isIdentifier(parameter.name)) {
    return {
      kind: "props-identifier",
      identifierName: parameter.name.text,
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

function collectFiniteStringValuesByProperty(
  parameter: ts.ParameterDeclaration,
): Map<string, string[]> {
  const valuesByProperty = new Map<string, string[]>();
  if (!parameter.type) {
    return valuesByProperty;
  }

  const typeAliases = collectLocalTypeAliases(parameter.getSourceFile());
  const propertyTypes = collectObjectPropertyTypes(parameter.type, typeAliases, new Set());
  for (const [propertyName, typeNode] of propertyTypes.entries()) {
    const values = resolveFiniteStringType(typeNode, typeAliases, new Set());
    if (values.length > 0) {
      valuesByProperty.set(propertyName, values);
    }
  }

  return valuesByProperty;
}

function collectLocalTypeAliases(sourceFile: ts.SourceFile): Map<string, ts.TypeNode> {
  const aliases = new Map<string, ts.TypeNode>();
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      aliases.set(statement.name.text, statement.type);
    }
  }

  return aliases;
}

function collectObjectPropertyTypes(
  typeNode: ts.TypeNode,
  typeAliases: Map<string, ts.TypeNode>,
  seenTypeNames: Set<string>,
): Map<string, ts.TypeNode> {
  if (ts.isTypeLiteralNode(typeNode)) {
    const propertyTypes = new Map<string, ts.TypeNode>();
    for (const member of typeNode.members) {
      if (!ts.isPropertySignature(member) || !member.type) {
        continue;
      }

      const propertyName = getStaticPropertyName(member.name);
      if (propertyName) {
        propertyTypes.set(propertyName, member.type);
      }
    }

    return propertyTypes;
  }

  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const typeName = typeNode.typeName.text;
    if (seenTypeNames.has(typeName)) {
      return new Map();
    }

    const aliasedType = typeAliases.get(typeName);
    if (!aliasedType) {
      return new Map();
    }

    return collectObjectPropertyTypes(
      aliasedType,
      typeAliases,
      new Set([...seenTypeNames, typeName]),
    );
  }

  return new Map();
}

function resolveFiniteStringType(
  typeNode: ts.TypeNode,
  typeAliases: Map<string, ts.TypeNode>,
  seenTypeNames: Set<string>,
): string[] {
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text];
  }

  if (ts.isUnionTypeNode(typeNode)) {
    const values = typeNode.types.flatMap((entry) =>
      resolveFiniteStringType(entry, typeAliases, seenTypeNames),
    );
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return resolveFiniteStringType(typeNode.type, typeAliases, seenTypeNames);
  }

  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const typeName = typeNode.typeName.text;
    if (seenTypeNames.has(typeName)) {
      return [];
    }

    const aliasedType = typeAliases.get(typeName);
    return aliasedType
      ? resolveFiniteStringType(aliasedType, typeAliases, new Set([...seenTypeNames, typeName]))
      : [];
  }

  return [];
}

function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}
