import ts from "typescript";

type LocalTypeEvidence = {
  typeAliases: Map<string, ts.TypeNode>;
  interfaces: Map<string, ts.InterfaceDeclaration>;
};

export function collectFiniteStringValuesByProperty(
  parameter: ts.ParameterDeclaration,
): Map<string, string[]> {
  const valuesByProperty = new Map<string, string[]>();
  if (!parameter.type) {
    return valuesByProperty;
  }

  const evidence = collectLocalTypeEvidence(parameter.getSourceFile());
  const propertyTypes = collectObjectPropertyTypes(parameter.type, evidence, new Set());
  for (const [propertyName, typeNode] of propertyTypes.entries()) {
    const values = resolveFiniteStringType(typeNode, evidence, new Set());
    if (values.length > 0) {
      valuesByProperty.set(propertyName, values);
    }
  }

  return valuesByProperty;
}

function collectLocalTypeEvidence(sourceFile: ts.SourceFile): LocalTypeEvidence {
  const typeAliases = new Map<string, ts.TypeNode>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      typeAliases.set(statement.name.text, statement.type);
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      interfaces.set(statement.name.text, statement);
    }
  }

  return { typeAliases, interfaces };
}

function collectObjectPropertyTypes(
  typeNode: ts.TypeNode,
  evidence: LocalTypeEvidence,
  seenTypeNames: Set<string>,
): Map<string, ts.TypeNode> {
  if (ts.isTypeLiteralNode(typeNode)) {
    return collectTypeLiteralPropertyTypes(typeNode);
  }

  if (ts.isIntersectionTypeNode(typeNode) || ts.isUnionTypeNode(typeNode)) {
    const merged = new Map<string, ts.TypeNode>();
    for (const entry of typeNode.types) {
      mergePropertyMaps(merged, collectObjectPropertyTypes(entry, evidence, seenTypeNames));
    }

    return merged;
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return collectObjectPropertyTypes(typeNode.type, evidence, seenTypeNames);
  }

  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const utilityType = collectSupportedUtilityObjectPropertyTypes(
      typeNode,
      evidence,
      seenTypeNames,
    );
    if (utilityType) {
      return utilityType;
    }

    return collectNamedObjectPropertyTypes(typeNode.typeName.text, evidence, seenTypeNames);
  }

  return new Map();
}

function collectTypeLiteralPropertyTypes(typeNode: ts.TypeLiteralNode): Map<string, ts.TypeNode> {
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

function collectNamedObjectPropertyTypes(
  typeName: string,
  evidence: LocalTypeEvidence,
  seenTypeNames: Set<string>,
): Map<string, ts.TypeNode> {
  if (seenTypeNames.has(typeName)) {
    return new Map();
  }

  const nextSeenTypeNames = new Set([...seenTypeNames, typeName]);
  const aliasedType = evidence.typeAliases.get(typeName);
  if (aliasedType) {
    return collectObjectPropertyTypes(aliasedType, evidence, nextSeenTypeNames);
  }

  const interfaceDeclaration = evidence.interfaces.get(typeName);
  if (!interfaceDeclaration) {
    return new Map();
  }

  const properties = new Map<string, ts.TypeNode>();
  for (const heritageClause of interfaceDeclaration.heritageClauses ?? []) {
    if (heritageClause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }

    for (const inheritedType of heritageClause.types) {
      if (ts.isIdentifier(inheritedType.expression)) {
        mergePropertyMaps(
          properties,
          collectNamedObjectPropertyTypes(
            inheritedType.expression.text,
            evidence,
            nextSeenTypeNames,
          ),
        );
      }
    }
  }

  mergePropertyMaps(properties, collectInterfaceOwnPropertyTypes(interfaceDeclaration));
  return properties;
}

function collectInterfaceOwnPropertyTypes(
  interfaceDeclaration: ts.InterfaceDeclaration,
): Map<string, ts.TypeNode> {
  const propertyTypes = new Map<string, ts.TypeNode>();
  for (const member of interfaceDeclaration.members) {
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

function collectSupportedUtilityObjectPropertyTypes(
  typeNode: ts.TypeReferenceNode,
  evidence: LocalTypeEvidence,
  seenTypeNames: Set<string>,
): Map<string, ts.TypeNode> | undefined {
  if (!ts.isIdentifier(typeNode.typeName)) {
    return undefined;
  }

  const utilityName = typeNode.typeName.text;
  const [sourceType, keysType] = typeNode.typeArguments ?? [];

  if (utilityName === "Partial" || utilityName === "Required" || utilityName === "Readonly") {
    return sourceType ? collectObjectPropertyTypes(sourceType, evidence, seenTypeNames) : new Map();
  }

  if (utilityName === "Pick" || utilityName === "Omit") {
    if (!sourceType || !keysType) {
      return new Map();
    }

    const properties = collectObjectPropertyTypes(sourceType, evidence, seenTypeNames);
    const selectedKeys = new Set(resolveFiniteStringType(keysType, evidence, new Set()));
    if (selectedKeys.size === 0 && keysType.kind !== ts.SyntaxKind.NeverKeyword) {
      return new Map();
    }

    if (utilityName === "Pick") {
      return new Map([...properties].filter(([propertyName]) => selectedKeys.has(propertyName)));
    }

    for (const key of selectedKeys) {
      properties.delete(key);
    }

    return properties;
  }

  return undefined;
}

function mergePropertyMaps(
  target: Map<string, ts.TypeNode>,
  source: Map<string, ts.TypeNode>,
): void {
  for (const [propertyName, propertyType] of source.entries()) {
    target.set(propertyName, mergePropertyTypeNodes(target.get(propertyName), propertyType));
  }
}

function mergePropertyTypeNodes(existing: ts.TypeNode | undefined, next: ts.TypeNode): ts.TypeNode {
  if (!existing) {
    return next;
  }

  return ts.factory.createUnionTypeNode([existing, next]);
}

function resolveFiniteStringType(
  typeNode: ts.TypeNode,
  evidence: LocalTypeEvidence,
  seenTypeNames: Set<string>,
): string[] {
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text];
  }

  if (ts.isUnionTypeNode(typeNode)) {
    const values = typeNode.types.flatMap((entry) =>
      resolveFiniteStringType(entry, evidence, seenTypeNames),
    );
    return uniqueSorted(values);
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return resolveFiniteStringType(typeNode.type, evidence, seenTypeNames);
  }

  if (ts.isIndexedAccessTypeNode(typeNode)) {
    return resolveIndexedAccessFiniteStringType(typeNode, evidence, seenTypeNames);
  }

  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const utilityValues = resolveSupportedUtilityFiniteStringType(
      typeNode,
      evidence,
      seenTypeNames,
    );
    if (utilityValues) {
      return utilityValues;
    }

    const typeName = typeNode.typeName.text;
    if (seenTypeNames.has(typeName)) {
      return [];
    }

    const aliasedType = evidence.typeAliases.get(typeName);
    return aliasedType
      ? resolveFiniteStringType(aliasedType, evidence, new Set([...seenTypeNames, typeName]))
      : [];
  }

  return [];
}

function resolveIndexedAccessFiniteStringType(
  typeNode: ts.IndexedAccessTypeNode,
  evidence: LocalTypeEvidence,
  seenTypeNames: Set<string>,
): string[] {
  const propertyNames = resolveFiniteStringType(typeNode.indexType, evidence, new Set());
  if (propertyNames.length === 0) {
    return [];
  }

  const properties = collectObjectPropertyTypes(typeNode.objectType, evidence, seenTypeNames);
  return uniqueSorted(
    propertyNames.flatMap((propertyName) => {
      const propertyType = properties.get(propertyName);
      return propertyType ? resolveFiniteStringType(propertyType, evidence, new Set()) : [];
    }),
  );
}

function resolveSupportedUtilityFiniteStringType(
  typeNode: ts.TypeReferenceNode,
  evidence: LocalTypeEvidence,
  seenTypeNames: Set<string>,
): string[] | undefined {
  if (!ts.isIdentifier(typeNode.typeName)) {
    return undefined;
  }

  const utilityName = typeNode.typeName.text;
  const [sourceType, filterType] = typeNode.typeArguments ?? [];

  if (utilityName === "NonNullable") {
    return sourceType ? resolveFiniteStringType(sourceType, evidence, seenTypeNames) : [];
  }

  if (utilityName === "Exclude" || utilityName === "Extract") {
    if (!sourceType || !filterType) {
      return [];
    }

    const sourceValues = resolveFiniteStringType(sourceType, evidence, seenTypeNames);
    const filterValues = new Set(resolveFiniteStringType(filterType, evidence, new Set()));
    if (filterValues.size === 0 && filterType.kind !== ts.SyntaxKind.NeverKeyword) {
      return [];
    }

    return utilityName === "Exclude"
      ? sourceValues.filter((value) => !filterValues.has(value))
      : sourceValues.filter((value) => filterValues.has(value));
  }

  return undefined;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}
