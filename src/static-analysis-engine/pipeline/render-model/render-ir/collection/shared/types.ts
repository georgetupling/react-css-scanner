import ts from "typescript";

import type { SourceAnchor } from "../../../../../types/core.js";
import type { UnsupportedParameterBindingReason } from "../../shared/expansionSemantics.js";

export type SameFileComponentDefinition = {
  componentName: string;
  exported: boolean;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  sourceAnchor: SourceAnchor;
  rootExpression: ts.Expression;
  localExpressionBindings: Map<string, ts.Expression>;
  localHelperDefinitions: Map<string, LocalHelperDefinition>;
  parameterBinding:
    | { kind: "none" }
    | { kind: "props-identifier"; identifierName: string }
    | {
        kind: "destructured-props";
        properties: Array<{
          propertyName: string;
          identifierName: string;
        }>;
      }
    | { kind: "unsupported"; reason: UnsupportedParameterBindingReason };
};

export type LocalHelperDefinition = {
  helperName: string;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  parameterNames: string[];
  returnExpression: ts.Expression;
  localExpressionBindings: Map<string, ts.Expression>;
};

export type DestructuredPropBinding = {
  propertyName: string;
  identifierName: string;
};
