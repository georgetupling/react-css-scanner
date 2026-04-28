import ts from "typescript";

import type { ProjectBindingResolution } from "../../../symbol-resolution/index.js";
import type {
  LocalHelperDefinition,
  SameFileComponentDefinition,
} from "../collection/shared/types.js";
import type { RenderNode } from "../types.js";

export type BoundExpression = {
  kind: "bound-expression";
  expression: ts.Expression;
  context: BuildContext;
};

export type ExpressionBinding = ts.Expression | BoundExpression;

export type BuildContext = {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  currentComponentFilePath: string;
  symbolResolution: ProjectBindingResolution;
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  currentDepth: number;
  expansionStack: string[];
  expressionBindings: Map<string, ExpressionBinding>;
  expressionBindingsBySymbolId: Map<string, ExpressionBinding>;
  stringSetBindings: Map<string, string[]>;
  helperDefinitions: Map<string, LocalHelperDefinition>;
  topLevelHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  topLevelExpressionBindingsBySymbolIdByFilePath: Map<string, Map<string, ts.Expression>>;
  namespaceExpressionBindingsBySymbolId: Map<string, Map<string, ts.Expression>>;
  namespaceHelperDefinitionsBySymbolId: Map<string, Map<string, LocalHelperDefinition>>;
  namespaceComponentDefinitionsBySymbolId: Map<string, Map<string, SameFileComponentDefinition>>;
  helperExpansionStack: string[];
  propsObjectBindingName?: string;
  propsObjectBindingSymbolId?: string;
  propsObjectProperties: Map<string, ExpressionBinding>;
  propsObjectSubtreeProperties: Map<string, RenderNode[]>;
  subtreeBindings: Map<string, RenderNode[]>;
  subtreeBindingsBySymbolId: Map<string, RenderNode[]>;
  includeTraces: boolean;
};
