import ts from "typescript";

import type { LanguageFrontendsResult } from "../../pipeline/language-frontends/index.js";
import type { FactGraphResult } from "../../pipeline/fact-graph/index.js";
import type { OwnershipInferenceResult } from "../../pipeline/ownership-inference/index.js";
import type { ProjectEvidenceAssemblyResult } from "../../pipeline/project-evidence/index.js";
import type { SelectorReachabilityResult } from "../../pipeline/selector-reachability/index.js";
import type { SymbolicEvaluationResult } from "../../pipeline/symbolic-evaluation/index.js";
import type { RenderStructureResult } from "../../pipeline/render-structure/index.js";

export type LanguageFrontendsStageResult = LanguageFrontendsResult;

export type FactGraphStageResult = FactGraphResult;

export type SymbolicEvaluationStageResult = SymbolicEvaluationResult;

export type RenderStructureStageResult = RenderStructureResult;

export type ParsedProjectFile = {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
};

export type SelectorReachabilityStageResult = {
  selectorReachability: SelectorReachabilityResult;
};

export type ProjectEvidenceStageResult = {
  projectEvidence: ProjectEvidenceAssemblyResult;
};

export type OwnershipInferenceStageResult = {
  ownershipInference: OwnershipInferenceResult;
};
