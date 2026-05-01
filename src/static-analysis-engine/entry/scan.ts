import { buildFactGraph } from "../pipeline/fact-graph/index.js";
import { buildLanguageFrontends } from "../pipeline/language-frontends/index.js";
import { buildOwnershipInference } from "../pipeline/ownership-inference/index.js";
import { buildProjectEvidenceAssembly } from "../pipeline/project-evidence/index.js";
import { buildRenderStructure } from "../pipeline/render-structure/index.js";
import { buildSelectorReachability } from "../pipeline/selector-reachability/index.js";
import { evaluateSymbolicExpressions } from "../pipeline/symbolic-evaluation/index.js";
import { buildProjectSnapshot } from "../pipeline/workspace-discovery/index.js";
import type {
  AnalysisProgressCallback,
  StaticAnalysisEngineProjectResult,
} from "../types/runtime.js";
import type { ScanProjectInput } from "../../project/types.js";

export async function runAnalysisPipeline(input: {
  scanInput: ScanProjectInput;
  onProgress?: AnalysisProgressCallback;
  includeTraces?: boolean;
}): Promise<StaticAnalysisEngineProjectResult> {
  const progress = createAnalysisProgressReporter(input.onProgress);
  const snapshot = await buildProjectSnapshot({
    scanInput: input.scanInput,
    rootDir: input.scanInput.rootDir,
    runStage: (stage, message, run) => runAsyncAnalysisStage(progress, stage, message, run),
  });
  const includeTraces = input.includeTraces ?? true;
  const frontends = runAnalysisStage(
    progress,
    "language-frontends",
    "Building language frontends",
    () => buildLanguageFrontends({ snapshot }),
  );
  const factGraph = runAnalysisStage(progress, "fact-graph", "Building fact graph", () =>
    buildFactGraph({
      snapshot,
      frontends,
      includeTraces,
    }),
  );
  const symbolicEvaluationStage = runAnalysisStage(
    progress,
    "symbolic-evaluation",
    "Evaluating symbolic class expressions",
    () => evaluateSymbolicExpressions({ graph: factGraph.graph, options: { includeTraces } }),
  );
  const renderStructureStage = runAnalysisStage(
    progress,
    "render-structure",
    "Building render structure",
    () =>
      buildRenderStructure({
        symbolicEvaluation: symbolicEvaluationStage,
        graph: factGraph.graph,
        options: {
          includeTraces,
        },
      }),
  );
  const selectorReachabilityStage = runAnalysisStage(
    progress,
    "selector-reachability",
    "Building selector reachability evidence",
    () => ({ selectorReachability: buildSelectorReachability(renderStructureStage) }),
  );
  const projectEvidenceStage = runAnalysisStage(
    progress,
    "project-evidence",
    "Building project evidence",
    () => ({
      projectEvidence: buildProjectEvidenceAssembly({
        projectInput: {
          factGraph,
          stylesheets: snapshot.files.stylesheets,
          renderModel: renderStructureStage.renderModel,
          symbolicEvaluation: symbolicEvaluationStage,
          selectorReachability: selectorReachabilityStage.selectorReachability,
        },
        options: {
          includeTraces,
          cssModuleLocalsConvention: snapshot.config.cssModules.localsConvention,
        },
      }),
    }),
  );
  const ownershipInferenceStage = runAnalysisStage(
    progress,
    "ownership-inference",
    "Building ownership inference",
    () => ({
      ownershipInference: buildOwnershipInference({
        projectEvidence: projectEvidenceStage.projectEvidence,
        selectorReachability: selectorReachabilityStage.selectorReachability,
        options: {
          includeTraces,
          sharedCssPatterns: [],
        },
      }),
    }),
  );

  return {
    snapshot,
    analysisEvidence: {
      projectEvidence: projectEvidenceStage.projectEvidence,
      selectorReachability: selectorReachabilityStage.selectorReachability,
      ownershipInference: ownershipInferenceStage.ownershipInference,
    },
  };
}

export const analyzeProjectScanInput = runAnalysisPipeline;

function createAnalysisProgressReporter(onProgress?: AnalysisProgressCallback) {
  return (
    stage: string,
    status: "started" | "completed",
    message: string,
    durationMs?: number,
  ): void => {
    onProgress?.({
      stage,
      status,
      message,
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  };
}

function runAnalysisStage<T>(
  progress: ReturnType<typeof createAnalysisProgressReporter>,
  stage: string,
  message: string,
  run: () => T,
): T {
  const startedAt = performance.now();
  progress(stage, "started", message);
  const result = run();
  progress(stage, "completed", message, performance.now() - startedAt);
  return result;
}

async function runAsyncAnalysisStage<T>(
  progress: ReturnType<typeof createAnalysisProgressReporter>,
  stage: string,
  message: string,
  run: () => T | Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  progress(stage, "started", message);
  const result = await run();
  progress(stage, "completed", message, performance.now() - startedAt);
  return result;
}
