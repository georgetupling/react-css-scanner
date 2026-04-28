import type {
  ClassContextAnalysis,
  ClassDefinitionAnalysis,
  ClassOwnershipAnalysis,
  ClassReferenceAnalysis,
  ClassReferenceMatchRelation,
  ComponentAnalysis,
  CssModuleAliasAnalysis,
  CssModuleDestructuredBindingAnalysis,
  CssModuleImportAnalysis,
  CssModuleMemberMatchRelation,
  CssModuleMemberReferenceAnalysis,
  CssModuleReferenceDiagnosticAnalysis,
  ProjectAnalysisIndexes,
  ProviderClassSatisfactionRelation,
  SelectorBranchAnalysis,
  SelectorMatchRelation,
  SelectorQueryAnalysis,
  SourceFileAnalysis,
  StaticallySkippedClassReferenceAnalysis,
  StylesheetAnalysis,
  UnsupportedClassReferenceAnalysis,
} from "../types.js";
import {
  pushMapValue,
  sortIndexValues,
  createReferenceClassKey,
  createStylesheetClassKey,
} from "./shared.js";

export function indexRelations(input: {
  referenceMatches: ClassReferenceMatchRelation[];
  providerClassSatisfactions: ProviderClassSatisfactionRelation[];
  selectorMatches: SelectorMatchRelation[];
  cssModuleMemberMatches: CssModuleMemberMatchRelation[];
  indexes: ProjectAnalysisIndexes;
}): void {
  for (const match of input.referenceMatches) {
    input.indexes.referenceMatchesById.set(match.id, match);
    pushMapValue(input.indexes.matchesByReferenceId, match.referenceId, match.id);
    pushMapValue(
      input.indexes.referenceMatchesByReferenceAndClassName,
      createReferenceClassKey(match.referenceId, match.className),
      match.id,
    );
  }
  for (const satisfaction of input.providerClassSatisfactions) {
    input.indexes.providerSatisfactionsById.set(satisfaction.id, satisfaction);
    pushMapValue(input.indexes.matchesByReferenceId, satisfaction.referenceId, satisfaction.id);
    pushMapValue(
      input.indexes.providerSatisfactionsByReferenceId,
      satisfaction.referenceId,
      satisfaction.id,
    );
    pushMapValue(
      input.indexes.providerSatisfactionsByReferenceAndClassName,
      createReferenceClassKey(satisfaction.referenceId, satisfaction.className),
      satisfaction.id,
    );
  }
  for (const match of input.selectorMatches) {
    input.indexes.selectorMatchesById.set(match.id, match);
    pushMapValue(input.indexes.selectorMatchesByQueryId, match.selectorQueryId, match.id);
  }
  for (const match of input.cssModuleMemberMatches) {
    input.indexes.cssModuleMemberMatchesById.set(match.id, match);
    pushMapValue(input.indexes.cssModuleMemberMatchesByReferenceId, match.referenceId, match.id);
    if (match.definitionId) {
      pushMapValue(
        input.indexes.cssModuleMemberMatchesByDefinitionId,
        match.definitionId,
        match.id,
      );
    }
  }

  sortIndexValues(input.indexes.matchesByReferenceId);
  sortIndexValues(input.indexes.referenceMatchesByReferenceAndClassName);
  sortIndexValues(input.indexes.providerSatisfactionsByReferenceId);
  sortIndexValues(input.indexes.providerSatisfactionsByReferenceAndClassName);
  sortIndexValues(input.indexes.selectorMatchesByQueryId);
  sortIndexValues(input.indexes.cssModuleMemberMatchesByReferenceId);
  sortIndexValues(input.indexes.cssModuleMemberMatchesByDefinitionId);
}

export function indexEntities(input: {
  sourceFiles: SourceFileAnalysis[];
  stylesheets: StylesheetAnalysis[];
  classReferences: ClassReferenceAnalysis[];
  staticallySkippedClassReferences: StaticallySkippedClassReferenceAnalysis[];
  classDefinitions: ClassDefinitionAnalysis[];
  classContexts: ClassContextAnalysis[];
  selectorQueries: SelectorQueryAnalysis[];
  selectorBranches: SelectorBranchAnalysis[];
  components: ComponentAnalysis[];
  unsupportedClassReferences: UnsupportedClassReferenceAnalysis[];
  cssModuleImports: CssModuleImportAnalysis[];
  cssModuleAliases: CssModuleAliasAnalysis[];
  cssModuleDestructuredBindings: CssModuleDestructuredBindingAnalysis[];
  cssModuleMemberReferences: CssModuleMemberReferenceAnalysis[];
  cssModuleReferenceDiagnostics: CssModuleReferenceDiagnosticAnalysis[];
  indexes: ProjectAnalysisIndexes;
}): void {
  for (const sourceFile of input.sourceFiles) {
    input.indexes.sourceFilesById.set(sourceFile.id, sourceFile);
  }
  for (const stylesheet of input.stylesheets) {
    input.indexes.stylesheetsById.set(stylesheet.id, stylesheet);
  }
  for (const reference of input.classReferences) {
    input.indexes.classReferencesById.set(reference.id, reference);
  }
  for (const reference of input.staticallySkippedClassReferences) {
    input.indexes.staticallySkippedClassReferencesById.set(reference.id, reference);
  }
  for (const definition of input.classDefinitions) {
    input.indexes.classDefinitionsById.set(definition.id, definition);
  }
  for (const context of input.classContexts) {
    input.indexes.classContextsById.set(context.id, context);
  }
  for (const selectorQuery of input.selectorQueries) {
    input.indexes.selectorQueriesById.set(selectorQuery.id, selectorQuery);
  }
  for (const selectorBranch of input.selectorBranches) {
    input.indexes.selectorBranchesById.set(selectorBranch.id, selectorBranch);
    pushMapValue(
      input.indexes.selectorBranchesByQueryId,
      selectorBranch.selectorQueryId,
      selectorBranch.id,
    );
    pushMapValue(
      input.indexes.selectorBranchesByRuleKey,
      selectorBranch.ruleKey,
      selectorBranch.id,
    );
    if (selectorBranch.stylesheetId) {
      pushMapValue(
        input.indexes.selectorBranchesByStylesheetId,
        selectorBranch.stylesheetId,
        selectorBranch.id,
      );
    }
  }
  for (const component of input.components) {
    input.indexes.componentsById.set(component.id, component);
  }
  for (const unsupportedReference of input.unsupportedClassReferences) {
    input.indexes.unsupportedClassReferencesById.set(unsupportedReference.id, unsupportedReference);
  }
  for (const cssModuleImport of input.cssModuleImports) {
    input.indexes.cssModuleImportsById.set(cssModuleImport.id, cssModuleImport);
    pushMapValue(
      input.indexes.cssModuleImportsBySourceFileId,
      cssModuleImport.sourceFileId,
      cssModuleImport.id,
    );
    pushMapValue(
      input.indexes.cssModuleImportsByStylesheetId,
      cssModuleImport.stylesheetId,
      cssModuleImport.id,
    );
  }
  for (const alias of input.cssModuleAliases) {
    input.indexes.cssModuleAliasesById.set(alias.id, alias);
    pushMapValue(input.indexes.cssModuleAliasesByImportId, alias.importId, alias.id);
  }
  for (const binding of input.cssModuleDestructuredBindings) {
    input.indexes.cssModuleDestructuredBindingsById.set(binding.id, binding);
    pushMapValue(
      input.indexes.cssModuleDestructuredBindingsByImportId,
      binding.importId,
      binding.id,
    );
  }
  for (const reference of input.cssModuleMemberReferences) {
    input.indexes.cssModuleMemberReferencesById.set(reference.id, reference);
    pushMapValue(
      input.indexes.cssModuleMemberReferencesByImportId,
      reference.importId,
      reference.id,
    );
    pushMapValue(
      input.indexes.cssModuleMemberReferencesByStylesheetAndClassName,
      createStylesheetClassKey(reference.stylesheetId, reference.memberName),
      reference.id,
    );
  }
  for (const diagnostic of input.cssModuleReferenceDiagnostics) {
    input.indexes.cssModuleReferenceDiagnosticsById.set(diagnostic.id, diagnostic);
    pushMapValue(
      input.indexes.cssModuleReferenceDiagnosticsByImportId,
      diagnostic.importId,
      diagnostic.id,
    );
  }

  sortIndexValues(input.indexes.cssModuleImportsBySourceFileId);
  sortIndexValues(input.indexes.selectorBranchesByQueryId);
  sortIndexValues(input.indexes.selectorBranchesByRuleKey);
  sortIndexValues(input.indexes.selectorBranchesByStylesheetId);
  sortIndexValues(input.indexes.cssModuleImportsByStylesheetId);
  sortIndexValues(input.indexes.cssModuleAliasesByImportId);
  sortIndexValues(input.indexes.cssModuleDestructuredBindingsByImportId);
  sortIndexValues(input.indexes.cssModuleMemberReferencesByImportId);
  sortIndexValues(input.indexes.cssModuleMemberReferencesByStylesheetAndClassName);
  sortIndexValues(input.indexes.cssModuleReferenceDiagnosticsByImportId);
}

export function indexClassOwnership(
  ownershipRecords: ClassOwnershipAnalysis[],
  indexes: ProjectAnalysisIndexes,
): void {
  for (const ownership of ownershipRecords) {
    indexes.classOwnershipById.set(ownership.id, ownership);
    indexes.classOwnershipByClassDefinitionId.set(ownership.classDefinitionId, ownership.id);
    pushMapValue(indexes.classOwnershipByStylesheetId, ownership.stylesheetId, ownership.id);

    for (const candidate of ownership.ownerCandidates) {
      if (candidate.kind === "component" && candidate.id) {
        pushMapValue(indexes.classOwnershipByOwnerComponentId, candidate.id, ownership.id);
      }
    }

    for (const consumerComponentId of ownership.consumerSummary.consumerComponentIds) {
      pushMapValue(indexes.classOwnershipByConsumerComponentId, consumerComponentId, ownership.id);
    }
  }

  sortIndexValues(indexes.classOwnershipByStylesheetId);
  sortIndexValues(indexes.classOwnershipByOwnerComponentId);
  sortIndexValues(indexes.classOwnershipByConsumerComponentId);
}

export function createEmptyIndexes(): ProjectAnalysisIndexes {
  return {
    sourceFilesById: new Map(),
    stylesheetsById: new Map(),
    classReferencesById: new Map(),
    staticallySkippedClassReferencesById: new Map(),
    classDefinitionsById: new Map(),
    classContextsById: new Map(),
    selectorQueriesById: new Map(),
    selectorBranchesById: new Map(),
    classOwnershipById: new Map(),
    componentsById: new Map(),
    unsupportedClassReferencesById: new Map(),
    cssModuleImportsById: new Map(),
    cssModuleAliasesById: new Map(),
    cssModuleDestructuredBindingsById: new Map(),
    cssModuleMemberReferencesById: new Map(),
    cssModuleReferenceDiagnosticsById: new Map(),
    sourceFileIdByPath: new Map(),
    stylesheetIdByPath: new Map(),
    componentIdByFilePathAndName: new Map(),
    componentIdByComponentKey: new Map(),
    definitionsByClassName: new Map(),
    definitionsByStylesheetId: new Map(),
    contextsByClassName: new Map(),
    contextsByStylesheetId: new Map(),
    referencesByClassName: new Map(),
    staticallySkippedReferencesByClassName: new Map(),
    referencesBySourceFileId: new Map(),
    reachableStylesheetsBySourceFileId: new Map(),
    reachableStylesheetsByComponentId: new Map(),
    selectorQueriesByStylesheetId: new Map(),
    selectorBranchesByStylesheetId: new Map(),
    selectorBranchesByQueryId: new Map(),
    selectorBranchesByRuleKey: new Map(),
    classOwnershipByClassDefinitionId: new Map(),
    classOwnershipByStylesheetId: new Map(),
    classOwnershipByOwnerComponentId: new Map(),
    classOwnershipByConsumerComponentId: new Map(),
    referenceMatchesById: new Map(),
    matchesByReferenceId: new Map(),
    referenceMatchesByReferenceAndClassName: new Map(),
    providerSatisfactionsById: new Map(),
    providerSatisfactionsByReferenceId: new Map(),
    providerSatisfactionsByReferenceAndClassName: new Map(),
    selectorMatchesById: new Map(),
    selectorMatchesByQueryId: new Map(),
    cssModuleMemberMatchesById: new Map(),
    cssModuleImportsBySourceFileId: new Map(),
    cssModuleImportsByStylesheetId: new Map(),
    cssModuleAliasesByImportId: new Map(),
    cssModuleDestructuredBindingsByImportId: new Map(),
    cssModuleMemberReferencesByImportId: new Map(),
    cssModuleMemberReferencesByStylesheetAndClassName: new Map(),
    cssModuleMemberMatchesByReferenceId: new Map(),
    cssModuleMemberMatchesByDefinitionId: new Map(),
    cssModuleReferenceDiagnosticsByImportId: new Map(),
  };
}
