import ts from "typescript";

import type {
  LocalHelperDefinition,
  SameFileComponentDefinition,
} from "../collection/shared/types.js";
import type { RenderNode } from "../types.js";

export type BuildContext = {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  currentComponentFilePath: string;
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  currentDepth: number;
  expansionStack: string[];
  expressionBindings: Map<string, ts.Expression>;
  helperDefinitions: Map<string, LocalHelperDefinition>;
  namespaceExpressionBindings: Map<string, Map<string, ts.Expression>>;
  namespaceHelperDefinitions: Map<string, Map<string, LocalHelperDefinition>>;
  namespaceComponentDefinitions: Map<string, Map<string, SameFileComponentDefinition>>;
  helperExpansionStack: string[];
  propsObjectBindingName?: string;
  propsObjectProperties: Map<string, ts.Expression>;
  propsObjectSubtreeProperties: Map<string, RenderNode[]>;
  subtreeBindings: Map<string, RenderNode[]>;
};
