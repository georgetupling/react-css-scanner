import type ts from "typescript";

import type { SourceAnchor } from "../../types/core.js";

export type ComponentLikeEvidence =
  | "renderable-function"
  | "class-component"
  | "react-wrapper-inline"
  | "react-wrapper-reference";

export type ComponentLikeDefinition = {
  componentName: string;
  filePath: string;
  exported: boolean;
  sourceAnchor: SourceAnchor;
  evidence: ComponentLikeEvidence;
  declarationKind: "function" | "variable" | "class";
  functionLikeNode?:
    | (ts.FunctionDeclaration & { body: ts.Block })
    | ts.ArrowFunction
    | ts.FunctionExpression;
  referencedComponentName?: string;
};
