import type {
  ClassContextAnalysis,
  ClassDefinitionAnalysis,
  ClassReferenceAnalysis,
  ComponentAnalysis,
  CssDeclarationAnalysis,
  CssModuleAliasAnalysis,
  CssModuleDestructuredBindingAnalysis,
  CssModuleImportAnalysis,
  CssModuleMemberReferenceAnalysis,
  CssModuleReferenceDiagnosticAnalysis,
  ProjectEvidenceBuilderIndexes,
  SelectorBranchAnalysis,
  SelectorQueryAnalysis,
  SourceFileAnalysis,
  StaticallySkippedClassReferenceAnalysis,
  StylesheetAnalysis,
  UnsupportedClassReferenceAnalysis,
} from "../analysisTypes.js";
import { pushMapValue, sortIndexValues, createStylesheetClassKey } from "./shared.js";

export function indexEntities(input: {
  sourceFiles: SourceFileAnalysis[];
  stylesheets: StylesheetAnalysis[];
  classReferences: ClassReferenceAnalysis[];
  staticallySkippedClassReferences: StaticallySkippedClassReferenceAnalysis[];
  classDefinitions: ClassDefinitionAnalysis[];
  classContexts: ClassContextAnalysis[];
  selectorQueries: SelectorQueryAnalysis[];
  selectorBranches: SelectorBranchAnalysis[];
  cssDeclarations: CssDeclarationAnalysis[];
  components: ComponentAnalysis[];
  unsupportedClassReferences: UnsupportedClassReferenceAnalysis[];
  cssModuleImports: CssModuleImportAnalysis[];
  cssModuleAliases: CssModuleAliasAnalysis[];
  cssModuleDestructuredBindings: CssModuleDestructuredBindingAnalysis[];
  cssModuleMemberReferences: CssModuleMemberReferenceAnalysis[];
  cssModuleReferenceDiagnostics: CssModuleReferenceDiagnosticAnalysis[];
  indexes: ProjectEvidenceBuilderIndexes;
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
  for (const declaration of input.cssDeclarations) {
    input.indexes.cssDeclarationsById.set(declaration.id, declaration);
    pushMapValue(
      input.indexes.cssDeclarationsByStylesheetId,
      declaration.stylesheetId,
      declaration.id,
    );
    pushMapValue(
      input.indexes.cssDeclarationsByRuleDefinitionNodeId,
      declaration.ruleDefinitionNodeId,
      declaration.id,
    );
    pushMapValue(input.indexes.cssDeclarationsByProperty, declaration.property, declaration.id);
    for (const selectorBranchId of declaration.selectorBranchIds) {
      pushMapValue(
        input.indexes.cssDeclarationsBySelectorBranchId,
        selectorBranchId,
        declaration.id,
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
  sortIndexValues(input.indexes.cssDeclarationsByStylesheetId);
  sortIndexValues(input.indexes.cssDeclarationsByRuleDefinitionNodeId);
  sortIndexValues(input.indexes.cssDeclarationsBySelectorBranchId);
  sortIndexValues(input.indexes.cssDeclarationsByProperty);
  sortIndexValues(input.indexes.cssModuleImportsByStylesheetId);
  sortIndexValues(input.indexes.cssModuleAliasesByImportId);
  sortIndexValues(input.indexes.cssModuleDestructuredBindingsByImportId);
  sortIndexValues(input.indexes.cssModuleMemberReferencesByImportId);
  sortIndexValues(input.indexes.cssModuleMemberReferencesByStylesheetAndClassName);
  sortIndexValues(input.indexes.cssModuleReferenceDiagnosticsByImportId);
}

export function createEmptyIndexes(): ProjectEvidenceBuilderIndexes {
  return {
    sourceFilesById: new Map(),
    stylesheetsById: new Map(),
    classReferencesById: new Map(),
    staticallySkippedClassReferencesById: new Map(),
    classDefinitionsById: new Map(),
    classContextsById: new Map(),
    selectorQueriesById: new Map(),
    selectorBranchesById: new Map(),
    cssDeclarationsById: new Map(),
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
    cssDeclarationsByStylesheetId: new Map(),
    cssDeclarationsByRuleDefinitionNodeId: new Map(),
    cssDeclarationsBySelectorBranchId: new Map(),
    cssDeclarationsByProperty: new Map(),
    cssModuleImportsBySourceFileId: new Map(),
    cssModuleImportsByStylesheetId: new Map(),
    cssModuleAliasesByImportId: new Map(),
    cssModuleDestructuredBindingsByImportId: new Map(),
    cssModuleMemberReferencesByImportId: new Map(),
    cssModuleMemberReferencesByStylesheetAndClassName: new Map(),
    cssModuleReferenceDiagnosticsByImportId: new Map(),
  };
}
