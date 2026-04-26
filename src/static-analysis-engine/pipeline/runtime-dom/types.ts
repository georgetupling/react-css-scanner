import type { ClassExpressionSummary } from "../render-model/abstract-values/types.js";
import type { SourceAnchor } from "../../types/core.js";
import type { AnalysisTrace } from "../../types/analysis.js";
import ts from "typescript";

export type RuntimeDomClassReferenceKind = "prosemirror-editor-view-attributes";

export type RuntimeDomClassReference = {
  kind: RuntimeDomClassReferenceKind;
  filePath: string;
  location: SourceAnchor;
  rawExpressionText: string;
  classExpression: ClassExpressionSummary;
  runtimeLibraryHint?: RuntimeDomLibraryHint;
};

export type RuntimeDomAdapterContext = {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  includeTraces: boolean;
};

export type RuntimeDomLibraryHint = {
  packageName: string;
  importedName: string;
  localName: string;
};

export type RuntimeDomAdapter = {
  adapterName: string;
  collectReferences: (
    node: ts.Node,
    context: RuntimeDomAdapterContext,
  ) => RuntimeDomClassReference[];
};

export type RuntimeDomReferenceTraceInput = {
  sourceAnchor: SourceAnchor;
  includeTraces: boolean;
  summary: string;
  adapterName: string;
};

export type RuntimeDomReferenceTrace = AnalysisTrace;
