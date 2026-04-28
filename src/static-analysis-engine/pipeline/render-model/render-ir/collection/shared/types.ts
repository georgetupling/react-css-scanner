import ts from "typescript";

import type { EngineSymbolId, SourceAnchor } from "../../../../../types/core.js";
import type { UnsupportedParameterBindingReason } from "../../shared/expansionSemantics.js";

export type ExpressionBindingEntry = {
  localName: string;
  declaration: ts.Identifier;
  expression: ts.Expression;
};

export type SameFileComponentDefinition = {
  componentKey: string;
  componentName: string;
  exported: boolean;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  sourceAnchor: SourceAnchor;
  rootExpression: ts.Expression;
  localExpressionBindingEntries: ExpressionBindingEntry[];
  localExpressionBindings: Map<string, ts.Expression>;
  localExpressionBindingsBySymbolId: Map<EngineSymbolId, ts.Expression>;
  localStringSetBindings: Map<string, string[]>;
  localHelperDefinitions: Map<string, LocalHelperDefinition>;
  parameterBinding:
    | { kind: "none" }
    | {
        kind: "props-identifier";
        identifierName: string;
        declaration: ts.Identifier;
        finiteStringValuesByProperty?: Map<string, string[]>;
      }
    | {
        kind: "destructured-props";
        properties: DestructuredPropBinding[];
      }
    | { kind: "unsupported"; reason: UnsupportedParameterBindingReason };
};

export type LocalHelperDefinition = {
  helperName: string;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  parameterNames: string[];
  parameterBindings: HelperParameterBinding[];
  restParameterName?: string;
  returnExpression: ts.Expression;
  localExpressionBindingEntries: ExpressionBindingEntry[];
  localExpressionBindings: Map<string, ts.Expression>;
  localExpressionBindingsBySymbolId: Map<EngineSymbolId, ts.Expression>;
  localStringSetBindings: Map<string, string[]>;
};

export type DestructuredPropBinding = {
  propertyName: string;
  identifierName: string;
  declaration?: ts.Identifier;
  initializer?: ts.Expression;
  finiteStringValues?: string[];
};

export type HelperParameterBinding =
  | {
      kind: "identifier";
      identifierName: string;
      declaration: ts.Identifier;
      finiteStringValuesByProperty?: Map<string, string[]>;
    }
  | {
      kind: "destructured-object";
      properties: DestructuredPropBinding[];
    };
