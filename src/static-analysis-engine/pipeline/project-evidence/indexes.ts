import type {
  ClassReferenceAnalysis,
  ProjectEvidenceId,
  StylesheetReachabilityRelation,
} from "./analysisTypes.js";
import { stylesheetReachabilityEvidenceId } from "./ids.js";
import type {
  ProjectEvidenceDiagnostic,
  ProjectEvidenceDiagnosticId,
  ProjectEvidenceEntities,
  ProjectEvidenceIndexes,
  ProjectEvidenceRelations,
} from "./types.js";

export function buildIndexes(input: {
  entities: ProjectEvidenceEntities;
  relations: ProjectEvidenceRelations;
  diagnostics: ProjectEvidenceDiagnostic[];
}): ProjectEvidenceIndexes {
  const sourceFilesById = new Map(
    input.entities.sourceFiles.map((sourceFile) => [sourceFile.id, sourceFile]),
  );
  const sourceFileIdByPath = new Map(
    input.entities.sourceFiles.map((sourceFile) => [sourceFile.filePath, sourceFile.id]),
  );
  const stylesheetsById = new Map(
    input.entities.stylesheets.map((stylesheet) => [stylesheet.id, stylesheet]),
  );
  const stylesheetIdByPath = new Map(
    input.entities.stylesheets
      .filter((stylesheet) => Boolean(stylesheet.filePath))
      .map((stylesheet) => [stylesheet.filePath ?? "", stylesheet.id]),
  );
  const componentsById = new Map(
    input.entities.components.map((component) => [component.id, component]),
  );
  const componentIdsBySourceFileId = new Map<ProjectEvidenceId, ProjectEvidenceId[]>();
  const classDefinitionsById = new Map(
    input.entities.classDefinitions.map((definition) => [definition.id, definition]),
  );
  const cssDeclarationsById = new Map(
    input.entities.cssDeclarations.map((declaration) => [declaration.id, declaration]),
  );
  const classDefinitionIdsByClassName = new Map<string, ProjectEvidenceId[]>();
  const classDefinitionIdsByStylesheetId = new Map<ProjectEvidenceId, ProjectEvidenceId[]>();
  const cssDeclarationIdsByStylesheetId = new Map<ProjectEvidenceId, ProjectEvidenceId[]>();
  const cssDeclarationIdsByRuleDefinitionNodeId = new Map<string, ProjectEvidenceId[]>();
  const cssDeclarationIdsBySelectorBranchId = new Map<ProjectEvidenceId, ProjectEvidenceId[]>();
  const cssDeclarationIdsByProperty = new Map<string, ProjectEvidenceId[]>();
  const classReferencesById = new Map(
    input.entities.classReferences.map((reference) => [reference.id, reference]),
  );
  const classReferenceIdsByClassName = new Map<string, ProjectEvidenceId[]>();
  const classReferenceIdsBySourceFileId = new Map<ProjectEvidenceId, ProjectEvidenceId[]>();
  const classReferenceMatchesById = new Map<
    ProjectEvidenceId,
    (typeof input.relations.referenceMatches)[number]
  >(input.relations.referenceMatches.map((match) => [match.id, match]));
  const classReferenceMatchIdsByDefinitionId = new Map<ProjectEvidenceId, ProjectEvidenceId[]>();
  const classReferenceMatchIdsByReferenceId = new Map<ProjectEvidenceId, ProjectEvidenceId[]>();
  const classReferenceMatchIdsByReferenceAndClassName = new Map<string, ProjectEvidenceId[]>();
  const providerClassSatisfactionsById = new Map<
    ProjectEvidenceId,
    (typeof input.relations.providerClassSatisfactions)[number]
  >(
    input.relations.providerClassSatisfactions.map((satisfaction) => [
      satisfaction.id,
      satisfaction,
    ]),
  );
  const providerClassSatisfactionIdsByReferenceAndClassName = new Map<
    string,
    ProjectEvidenceId[]
  >();
  const stylesheetReachabilityIdsByStylesheetId = new Map<ProjectEvidenceId, ProjectEvidenceId[]>();
  const selectorBranchesById = new Map(
    input.entities.selectorBranches.map((branch) => [branch.id, branch]),
  );
  const selectorBranchIdsByStylesheetId = new Map<ProjectEvidenceId, ProjectEvidenceId[]>();
  const diagnosticById = new Map<ProjectEvidenceDiagnosticId, ProjectEvidenceDiagnostic>();
  const diagnosticsByTargetId = new Map<ProjectEvidenceId, ProjectEvidenceDiagnosticId[]>();

  for (const component of input.entities.components) {
    const sourceFileId = sourceFileIdByPath.get(component.filePath);
    if (sourceFileId) {
      pushMapValue(componentIdsBySourceFileId, sourceFileId, component.id);
    }
  }

  for (const definition of input.entities.classDefinitions) {
    pushMapValue(classDefinitionIdsByClassName, definition.className, definition.id);
    pushMapValue(classDefinitionIdsByStylesheetId, definition.stylesheetId, definition.id);
  }

  for (const declaration of input.entities.cssDeclarations) {
    pushMapValue(cssDeclarationIdsByStylesheetId, declaration.stylesheetId, declaration.id);
    pushMapValue(
      cssDeclarationIdsByRuleDefinitionNodeId,
      declaration.ruleDefinitionNodeId,
      declaration.id,
    );
    pushMapValue(cssDeclarationIdsByProperty, declaration.property, declaration.id);
    for (const selectorBranchId of declaration.selectorBranchIds) {
      pushMapValue(cssDeclarationIdsBySelectorBranchId, selectorBranchId, declaration.id);
    }
  }

  for (const reference of input.entities.classReferences) {
    pushMapValue(classReferenceIdsBySourceFileId, reference.sourceFileId, reference.id);
    for (const className of referenceClassNames(reference)) {
      pushMapValue(classReferenceIdsByClassName, className, reference.id);
    }
  }

  for (const match of input.relations.referenceMatches) {
    pushMapValue(classReferenceMatchIdsByDefinitionId, match.definitionId, match.id);
    pushMapValue(classReferenceMatchIdsByReferenceId, match.referenceId, match.id);
    pushMapValue(
      classReferenceMatchIdsByReferenceAndClassName,
      createReferenceClassKey(match.referenceId, match.className),
      match.id,
    );
  }

  for (const satisfaction of input.relations.providerClassSatisfactions) {
    pushMapValue(
      providerClassSatisfactionIdsByReferenceAndClassName,
      createReferenceClassKey(satisfaction.referenceId, satisfaction.className),
      satisfaction.id,
    );
  }

  for (const relation of input.relations.stylesheetReachability) {
    pushMapValue(
      stylesheetReachabilityIdsByStylesheetId,
      relation.stylesheetId,
      stylesheetReachabilityRelationId(relation),
    );
  }

  for (const branch of input.entities.selectorBranches) {
    if (branch.stylesheetId) {
      pushMapValue(selectorBranchIdsByStylesheetId, branch.stylesheetId, branch.id);
    }
  }

  for (const diagnostic of input.diagnostics) {
    diagnosticById.set(diagnostic.id, diagnostic);
    if (diagnostic.targetId) {
      pushMapValue(diagnosticsByTargetId, diagnostic.targetId, diagnostic.id);
    }
  }

  [
    componentIdsBySourceFileId,
    classDefinitionIdsByClassName,
    classDefinitionIdsByStylesheetId,
    cssDeclarationIdsByStylesheetId,
    cssDeclarationIdsByRuleDefinitionNodeId,
    cssDeclarationIdsBySelectorBranchId,
    cssDeclarationIdsByProperty,
    classReferenceIdsByClassName,
    classReferenceIdsBySourceFileId,
    classReferenceMatchIdsByDefinitionId,
    classReferenceMatchIdsByReferenceId,
    classReferenceMatchIdsByReferenceAndClassName,
    providerClassSatisfactionIdsByReferenceAndClassName,
    stylesheetReachabilityIdsByStylesheetId,
    selectorBranchIdsByStylesheetId,
    diagnosticsByTargetId,
  ].forEach(sortMapValues);

  return {
    sourceFilesById,
    sourceFileIdByPath,
    stylesheetsById,
    stylesheetIdByPath,
    componentsById,
    componentIdsBySourceFileId,
    classDefinitionsById,
    classDefinitionIdsByClassName,
    classDefinitionIdsByStylesheetId,
    cssDeclarationsById,
    cssDeclarationIdsByStylesheetId,
    cssDeclarationIdsByRuleDefinitionNodeId,
    cssDeclarationIdsBySelectorBranchId,
    cssDeclarationIdsByProperty,
    classReferencesById,
    classReferenceIdsByClassName,
    classReferenceIdsBySourceFileId,
    classReferenceMatchesById,
    classReferenceMatchIdsByDefinitionId,
    classReferenceMatchIdsByReferenceId,
    classReferenceMatchIdsByReferenceAndClassName,
    providerClassSatisfactionsById,
    providerClassSatisfactionIdsByReferenceAndClassName,
    stylesheetReachabilityIdsByStylesheetId,
    selectorBranchesById,
    selectorBranchIdsByStylesheetId,
    diagnosticById,
    diagnosticsByTargetId,
  };
}

function createReferenceClassKey(referenceId: string, className: string): string {
  return `${referenceId}::${className}`;
}

function referenceClassNames(reference: ClassReferenceAnalysis): string[] {
  return [...new Set([...reference.definiteClassNames, ...reference.possibleClassNames])].sort(
    (left, right) => left.localeCompare(right),
  );
}

function stylesheetReachabilityRelationId(relation: StylesheetReachabilityRelation): string {
  return stylesheetReachabilityEvidenceId({
    stylesheetId: relation.stylesheetId,
    sourceFileId: relation.sourceFileId,
    componentId: relation.componentId,
    availability: relation.availability,
  });
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sortMapValues(map: Map<string, string[]>): void {
  for (const [key, values] of map.entries()) {
    map.set(
      key,
      [...new Set(values)].sort((left, right) => left.localeCompare(right)),
    );
  }
}
