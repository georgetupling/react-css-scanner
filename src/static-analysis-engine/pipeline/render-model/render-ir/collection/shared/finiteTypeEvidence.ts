import ts from "typescript";

type LocalTypeEvidence = {
  filePath: string;
  cache?: FiniteTypeEvidenceCache;
  typeAliases: Map<string, ts.TypeNode>;
  interfaces: Map<string, ts.InterfaceDeclaration>;
  importedTypes: Map<string, ImportedTypeReference>;
  localExportNames: Map<string, string>;
  reExportedTypes: Map<string, ImportedTypeReference>;
};

type ImportedTypeReference = {
  filePath: string;
  importedName: string;
};

type ResolvedTypeDeclaration =
  | { kind: "type-alias"; type: ts.TypeNode; evidence: LocalTypeEvidence }
  | { kind: "interface"; declaration: ts.InterfaceDeclaration; evidence: LocalTypeEvidence };

type TypeResolutionState = {
  seenTypeNames: Set<string>;
  seenExportNames: Set<string>;
};

export type FiniteTypeEvidenceCache = {
  parsedSourceFilesByFilePath: Map<string, ts.SourceFile>;
  evidenceByFilePath: Map<string, LocalTypeEvidence>;
  resolvedExportedTypesByKey: Map<string, ResolvedTypeDeclaration | undefined>;
};

export function createFiniteTypeEvidenceCache(
  parsedFiles: Array<{
    filePath: string;
    parsedSourceFile: ts.SourceFile;
  }>,
): FiniteTypeEvidenceCache {
  return {
    parsedSourceFilesByFilePath: new Map(
      parsedFiles.map((parsedFile) => [
        normalizeProjectPath(parsedFile.filePath),
        parsedFile.parsedSourceFile,
      ]),
    ),
    evidenceByFilePath: new Map(),
    resolvedExportedTypesByKey: new Map(),
  };
}

export function collectFiniteStringValuesByProperty(
  parameter: ts.ParameterDeclaration,
  cache?: FiniteTypeEvidenceCache,
): Map<string, string[]> {
  const valuesByProperty = new Map<string, string[]>();
  if (!parameter.type) {
    return valuesByProperty;
  }

  const evidence = getLocalTypeEvidence(
    normalizeProjectPath(parameter.getSourceFile().fileName),
    parameter.getSourceFile(),
    cache,
  );
  const propertyTypes = collectObjectPropertyTypes(parameter.type, evidence, {
    seenTypeNames: new Set(),
    seenExportNames: new Set(),
  });
  for (const [propertyName, typeNode] of propertyTypes.entries()) {
    const values = resolveFiniteStringType(typeNode, evidence, {
      seenTypeNames: new Set(),
      seenExportNames: new Set(),
    });
    if (values.length > 0) {
      valuesByProperty.set(propertyName, values);
    }
  }

  return valuesByProperty;
}

function getLocalTypeEvidence(
  filePath: string,
  sourceFile: ts.SourceFile,
  cache: FiniteTypeEvidenceCache | undefined,
): LocalTypeEvidence {
  const normalizedFilePath = normalizeProjectPath(filePath);
  const cachedEvidence = cache?.evidenceByFilePath.get(normalizedFilePath);
  if (cachedEvidence) {
    return cachedEvidence;
  }

  const evidence = collectLocalTypeEvidence(normalizedFilePath, sourceFile, cache);
  cache?.evidenceByFilePath.set(normalizedFilePath, evidence);
  return evidence;
}

function collectLocalTypeEvidence(
  filePath: string,
  sourceFile: ts.SourceFile,
  cache: FiniteTypeEvidenceCache | undefined,
): LocalTypeEvidence {
  const typeAliases = new Map<string, ts.TypeNode>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const importedTypes = new Map<string, ImportedTypeReference>();
  const localExportNames = new Map<string, string>();
  const reExportedTypes = new Map<string, ImportedTypeReference>();

  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      typeAliases.set(statement.name.text, statement.type);
      if (isExported(statement)) {
        localExportNames.set(statement.name.text, statement.name.text);
      }
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      interfaces.set(statement.name.text, statement);
      if (isExported(statement)) {
        localExportNames.set(statement.name.text, statement.name.text);
      }
      continue;
    }

    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      collectImportedTypeReferences(statement, filePath, cache, importedTypes);
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      collectExportedTypeReferences(statement, filePath, cache, localExportNames, reExportedTypes);
    }
  }

  return {
    filePath,
    cache,
    typeAliases,
    interfaces,
    importedTypes,
    localExportNames,
    reExportedTypes,
  };
}

function collectImportedTypeReferences(
  statement: ts.ImportDeclaration,
  filePath: string,
  cache: FiniteTypeEvidenceCache | undefined,
  importedTypes: Map<string, ImportedTypeReference>,
): void {
  if (!statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return;
  }

  const importedFilePath = resolveProjectLocalSourceSpecifier(
    filePath,
    statement.moduleSpecifier.text,
    cache,
  );
  if (!importedFilePath || !statement.importClause.namedBindings) {
    return;
  }

  if (!ts.isNamedImports(statement.importClause.namedBindings)) {
    return;
  }

  for (const element of statement.importClause.namedBindings.elements) {
    if (!statement.importClause.isTypeOnly && !element.isTypeOnly) {
      continue;
    }

    importedTypes.set(element.name.text, {
      filePath: importedFilePath,
      importedName: element.propertyName?.text ?? element.name.text,
    });
  }
}

function collectExportedTypeReferences(
  statement: ts.ExportDeclaration,
  filePath: string,
  cache: FiniteTypeEvidenceCache | undefined,
  localExportNames: Map<string, string>,
  reExportedTypes: Map<string, ImportedTypeReference>,
): void {
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
    return;
  }

  if (!statement.moduleSpecifier) {
    for (const element of statement.exportClause.elements) {
      if (statement.isTypeOnly || element.isTypeOnly) {
        localExportNames.set(element.name.text, element.propertyName?.text ?? element.name.text);
      }
    }
    return;
  }

  if (!ts.isStringLiteral(statement.moduleSpecifier)) {
    return;
  }

  const importedFilePath = resolveProjectLocalSourceSpecifier(
    filePath,
    statement.moduleSpecifier.text,
    cache,
  );
  if (!importedFilePath) {
    return;
  }

  for (const element of statement.exportClause.elements) {
    if (!statement.isTypeOnly && !element.isTypeOnly) {
      continue;
    }

    reExportedTypes.set(element.name.text, {
      filePath: importedFilePath,
      importedName: element.propertyName?.text ?? element.name.text,
    });
  }
}

function collectObjectPropertyTypes(
  typeNode: ts.TypeNode,
  evidence: LocalTypeEvidence,
  state: TypeResolutionState,
): Map<string, ts.TypeNode> {
  if (ts.isTypeLiteralNode(typeNode)) {
    return collectTypeLiteralPropertyTypes(typeNode);
  }

  if (ts.isIntersectionTypeNode(typeNode) || ts.isUnionTypeNode(typeNode)) {
    const merged = new Map<string, ts.TypeNode>();
    for (const entry of typeNode.types) {
      mergePropertyMaps(merged, collectObjectPropertyTypes(entry, evidence, state));
    }

    return merged;
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return collectObjectPropertyTypes(typeNode.type, evidence, state);
  }

  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const utilityType = collectSupportedUtilityObjectPropertyTypes(typeNode, evidence, state);
    if (utilityType) {
      return utilityType;
    }

    return collectNamedObjectPropertyTypes(typeNode.typeName.text, evidence, state);
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
  state: TypeResolutionState,
): Map<string, ts.TypeNode> {
  const typeKey = createTypeKey(evidence.filePath, typeName);
  if (state.seenTypeNames.has(typeKey)) {
    return new Map();
  }

  const nextState = {
    ...state,
    seenTypeNames: new Set([...state.seenTypeNames, typeKey]),
  };
  const aliasedType = evidence.typeAliases.get(typeName);
  if (aliasedType) {
    return collectObjectPropertyTypes(aliasedType, evidence, nextState);
  }

  const interfaceDeclaration = evidence.interfaces.get(typeName);
  if (interfaceDeclaration) {
    return collectInterfacePropertyTypes(interfaceDeclaration, evidence, nextState);
  }

  const importedDeclaration = resolveImportedTypeDeclaration(typeName, evidence, nextState);
  if (!importedDeclaration) {
    return new Map();
  }

  return importedDeclaration.kind === "interface"
    ? collectInterfacePropertyTypes(
        importedDeclaration.declaration,
        importedDeclaration.evidence,
        nextState,
      )
    : collectObjectPropertyTypes(importedDeclaration.type, importedDeclaration.evidence, nextState);
}

function collectInterfacePropertyTypes(
  interfaceDeclaration: ts.InterfaceDeclaration,
  evidence: LocalTypeEvidence,
  state: TypeResolutionState,
): Map<string, ts.TypeNode> {
  const properties = new Map<string, ts.TypeNode>();
  for (const heritageClause of interfaceDeclaration.heritageClauses ?? []) {
    if (heritageClause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }

    for (const inheritedType of heritageClause.types) {
      if (ts.isIdentifier(inheritedType.expression)) {
        mergePropertyMaps(
          properties,
          collectNamedObjectPropertyTypes(inheritedType.expression.text, evidence, state),
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
  state: TypeResolutionState,
): Map<string, ts.TypeNode> | undefined {
  if (!ts.isIdentifier(typeNode.typeName)) {
    return undefined;
  }

  const utilityName = typeNode.typeName.text;
  const [sourceType, keysType] = typeNode.typeArguments ?? [];

  if (utilityName === "Partial" || utilityName === "Required" || utilityName === "Readonly") {
    return sourceType ? collectObjectPropertyTypes(sourceType, evidence, state) : new Map();
  }

  if (utilityName === "Pick" || utilityName === "Omit") {
    if (!sourceType || !keysType) {
      return new Map();
    }

    const properties = collectObjectPropertyTypes(sourceType, evidence, state);
    const selectedKeys = new Set(
      resolveFiniteStringType(keysType, evidence, {
        seenTypeNames: new Set(),
        seenExportNames: new Set(),
      }),
    );
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
  state: TypeResolutionState,
): string[] {
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text];
  }

  if (ts.isUnionTypeNode(typeNode)) {
    const values = typeNode.types.flatMap((entry) =>
      resolveFiniteStringType(entry, evidence, state),
    );
    return uniqueSorted(values);
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return resolveFiniteStringType(typeNode.type, evidence, state);
  }

  if (ts.isIndexedAccessTypeNode(typeNode)) {
    return resolveIndexedAccessFiniteStringType(typeNode, evidence, state);
  }

  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const utilityValues = resolveSupportedUtilityFiniteStringType(typeNode, evidence, state);
    if (utilityValues) {
      return utilityValues;
    }

    const typeName = typeNode.typeName.text;
    const typeKey = createTypeKey(evidence.filePath, typeName);
    if (state.seenTypeNames.has(typeKey)) {
      return [];
    }

    const nextState = {
      ...state,
      seenTypeNames: new Set([...state.seenTypeNames, typeKey]),
    };
    const aliasedType = evidence.typeAliases.get(typeName);
    if (aliasedType) {
      return resolveFiniteStringType(aliasedType, evidence, nextState);
    }

    const importedDeclaration = resolveImportedTypeDeclaration(typeName, evidence, nextState);
    if (!importedDeclaration || importedDeclaration.kind !== "type-alias") {
      return [];
    }

    return resolveFiniteStringType(
      importedDeclaration.type,
      importedDeclaration.evidence,
      nextState,
    );
  }

  return [];
}

function resolveIndexedAccessFiniteStringType(
  typeNode: ts.IndexedAccessTypeNode,
  evidence: LocalTypeEvidence,
  state: TypeResolutionState,
): string[] {
  const propertyNames = resolveFiniteStringType(typeNode.indexType, evidence, {
    seenTypeNames: new Set(),
    seenExportNames: new Set(),
  });
  if (propertyNames.length === 0) {
    return [];
  }

  const properties = collectObjectPropertyTypes(typeNode.objectType, evidence, state);
  return uniqueSorted(
    propertyNames.flatMap((propertyName) => {
      const propertyType = properties.get(propertyName);
      return propertyType
        ? resolveFiniteStringType(propertyType, evidence, {
            seenTypeNames: new Set(),
            seenExportNames: new Set(),
          })
        : [];
    }),
  );
}

function resolveSupportedUtilityFiniteStringType(
  typeNode: ts.TypeReferenceNode,
  evidence: LocalTypeEvidence,
  state: TypeResolutionState,
): string[] | undefined {
  if (!ts.isIdentifier(typeNode.typeName)) {
    return undefined;
  }

  const utilityName = typeNode.typeName.text;
  const [sourceType, filterType] = typeNode.typeArguments ?? [];

  if (utilityName === "NonNullable") {
    return sourceType ? resolveFiniteStringType(sourceType, evidence, state) : [];
  }

  if (utilityName === "Exclude" || utilityName === "Extract") {
    if (!sourceType || !filterType) {
      return [];
    }

    const sourceValues = resolveFiniteStringType(sourceType, evidence, state);
    const filterValues = new Set(
      resolveFiniteStringType(filterType, evidence, {
        seenTypeNames: new Set(),
        seenExportNames: new Set(),
      }),
    );
    if (filterValues.size === 0 && filterType.kind !== ts.SyntaxKind.NeverKeyword) {
      return [];
    }

    return utilityName === "Exclude"
      ? sourceValues.filter((value) => !filterValues.has(value))
      : sourceValues.filter((value) => filterValues.has(value));
  }

  return undefined;
}

function resolveImportedTypeDeclaration(
  typeName: string,
  evidence: LocalTypeEvidence,
  state: TypeResolutionState,
): ResolvedTypeDeclaration | undefined {
  const importedType = evidence.importedTypes.get(typeName);
  if (!importedType) {
    return undefined;
  }

  return resolveExportedTypeDeclaration(
    importedType.filePath,
    importedType.importedName,
    evidence.cache,
    state,
  );
}

function resolveExportedTypeDeclaration(
  filePath: string,
  exportedName: string,
  cache: FiniteTypeEvidenceCache | undefined,
  state: TypeResolutionState,
): ResolvedTypeDeclaration | undefined {
  const normalizedFilePath = normalizeProjectPath(filePath);
  const exportKey = createTypeKey(normalizedFilePath, exportedName);
  if (state.seenExportNames.has(exportKey)) {
    return undefined;
  }

  const sourceFile = cache?.parsedSourceFilesByFilePath.get(normalizedFilePath);
  if (!cache || !sourceFile) {
    return undefined;
  }

  if (cache.resolvedExportedTypesByKey.has(exportKey)) {
    const cachedDeclaration = cache.resolvedExportedTypesByKey.get(exportKey);
    return cachedDeclaration;
  }

  const nextState = {
    ...state,
    seenExportNames: new Set([...state.seenExportNames, exportKey]),
  };
  const targetEvidence = getLocalTypeEvidence(normalizedFilePath, sourceFile, cache);
  const localName = targetEvidence.localExportNames.get(exportedName);
  if (localName) {
    const localDeclaration = resolveLocalTypeDeclaration(localName, targetEvidence);
    cache.resolvedExportedTypesByKey.set(exportKey, localDeclaration);
    return localDeclaration;
  }

  const reExportedType = targetEvidence.reExportedTypes.get(exportedName);
  if (!reExportedType) {
    cache.resolvedExportedTypesByKey.set(exportKey, undefined);
    return undefined;
  }

  const reExportedDeclaration = resolveExportedTypeDeclaration(
    reExportedType.filePath,
    reExportedType.importedName,
    cache,
    nextState,
  );
  cache.resolvedExportedTypesByKey.set(exportKey, reExportedDeclaration);
  return reExportedDeclaration;
}

function resolveLocalTypeDeclaration(
  typeName: string,
  evidence: LocalTypeEvidence,
): ResolvedTypeDeclaration | undefined {
  const type = evidence.typeAliases.get(typeName);
  if (type) {
    return { kind: "type-alias", type, evidence };
  }

  const declaration = evidence.interfaces.get(typeName);
  return declaration ? { kind: "interface", declaration, evidence } : undefined;
}

function resolveProjectLocalSourceSpecifier(
  fromFilePath: string,
  specifier: string,
  cache: FiniteTypeEvidenceCache | undefined,
): string | undefined {
  if (!cache || !specifier.startsWith(".")) {
    return undefined;
  }

  const normalizedFromFilePath = normalizeProjectPath(fromFilePath);
  const fromSegments = normalizedFromFilePath.split("/");
  fromSegments.pop();
  const baseSegments = specifier.split("/").filter((segment) => segment.length > 0);
  const candidateBasePath = normalizeSegments([...fromSegments, ...baseSegments]);
  const candidatePaths = [
    candidateBasePath,
    `${candidateBasePath}.ts`,
    `${candidateBasePath}.tsx`,
    `${candidateBasePath}.js`,
    `${candidateBasePath}.jsx`,
    `${candidateBasePath}/index.ts`,
    `${candidateBasePath}/index.tsx`,
    `${candidateBasePath}/index.js`,
    `${candidateBasePath}/index.jsx`,
  ];

  return candidatePaths.find((candidatePath) =>
    cache.parsedSourceFilesByFilePath.has(candidatePath),
  );
}

function normalizeSegments(segments: string[]): string {
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalized.pop();
      continue;
    }

    normalized.push(segment);
  }

  return normalized.join("/");
}

function createTypeKey(filePath: string, typeName: string): string {
  return `${normalizeProjectPath(filePath)}:${typeName}`;
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

function isExported(
  node: ts.TypeAliasDeclaration | ts.InterfaceDeclaration | ts.ExportDeclaration,
): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
