import ts from "typescript";
import type { ClassReferenceFact } from "../facts/types.js";

export type LocalFunctionBinding = {
  bodyExpression: ts.Expression;
  parameters: readonly ts.ParameterDeclaration[];
};

export type ClassExpressionEvaluationContext = {
  helperImports: Set<string>;
  localBindings: Map<string, ts.Expression>;
  localFunctions: Map<string, LocalFunctionBinding>;
  parsedSourceFile: ts.SourceFile;
};

export type EvaluationEnvironment = Map<string, ts.Expression>;

export type TokenCertainty = "definite" | "possible";

export type TokenEvaluation = {
  token: string;
  certainty: TokenCertainty;
  kind: ClassReferenceFact["kind"];
  confidence: ClassReferenceFact["confidence"];
  source: string;
  anchorNode: ts.Node;
};

export type DynamicEvaluation = {
  kind: ClassReferenceFact["kind"];
  confidence: ClassReferenceFact["confidence"];
  source: string;
  anchorNode: ts.Node;
};

export type ClassExpressionEvaluation = {
  tokens: TokenEvaluation[];
  dynamics: DynamicEvaluation[];
};

export type EvaluationHelpers = {
  context: ClassExpressionEvaluationContext;
  evaluateExpression: (
    expression: ts.Expression,
    env: EvaluationEnvironment,
    depth: number,
  ) => ClassExpressionEvaluation;
  evaluateArrayElements: (
    elements: readonly ts.Expression[] | ts.NodeArray<ts.Expression>,
    env: EvaluationEnvironment,
    depth: number,
  ) => ClassExpressionEvaluation;
  evaluateArrayLikeExpression: (
    expression: ts.Expression,
    env: EvaluationEnvironment,
    depth: number,
  ) => ClassExpressionEvaluation;
  mergeInto: (target: ClassExpressionEvaluation, input: ClassExpressionEvaluation) => void;
  mergeBranchResults: (
    left: ClassExpressionEvaluation,
    right: ClassExpressionEvaluation,
  ) => ClassExpressionEvaluation;
  markAllTokensAsExpressionEvaluated: (
    result: ClassExpressionEvaluation,
  ) => ClassExpressionEvaluation;
  downgradeTokensToPossible: (
    result: ClassExpressionEvaluation,
  ) => ClassExpressionEvaluation;
  tokensFromString: (
    value: string,
    anchorNode: ts.Node,
    kind: ClassReferenceFact["kind"],
    confidence: ClassReferenceFact["confidence"],
  ) => ClassExpressionEvaluation;
  tokenResult: (
    tokenValue: string,
    certainty: TokenCertainty,
    anchorNode: ts.Node,
    kind: ClassReferenceFact["kind"],
    confidence: ClassReferenceFact["confidence"],
    source: string,
  ) => ClassExpressionEvaluation;
  dynamicOnly: (
    anchorNode: ts.Node,
    kind: ClassReferenceFact["kind"],
    confidence: ClassReferenceFact["confidence"],
  ) => ClassExpressionEvaluation;
  emptyEvaluation: () => ClassExpressionEvaluation;
  resolveBooleanValue: (
    expression: ts.Expression,
    env: EvaluationEnvironment,
    seenIdentifiers: Set<string>,
  ) => boolean | undefined;
  resolveIdentifierExpression: (
    expression: ts.Identifier,
    env: EvaluationEnvironment,
  ) => ts.Expression | undefined;
  getStaticPropertyName: (name: ts.PropertyName) => string | undefined;
};
