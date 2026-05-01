import type { ProjectSnapshot } from "../pipeline/workspace-discovery/index.js";
import type {
  AnalysisProgressCallback,
  StaticAnalysisEngineProjectResult,
  StaticAnalysisEngineResult,
} from "../types/runtime.js";
import type { ScanProjectInput } from "../../project/types.js";
import { runFactGraphStage } from "./stages/factGraphStage.js";
import { runLanguageFrontendsStage } from "./stages/languageFrontendsStage.js";
import { runOwnershipInferenceStage } from "./stages/ownershipInferenceStage.js";
import { runProjectEvidenceStage } from "./stages/projectEvidenceStage.js";
import { runRenderStructureStage } from "./stages/renderStructureStage.js";
import { runSelectorReachabilityStage } from "./stages/selectorReachabilityStage.js";
import { runSymbolicEvaluationStage } from "./stages/symbolicEvaluationStage.js";
import { runWorkspaceDiscoveryStage } from "./stages/workspaceDiscoveryStage.js";

export async function analyzeProjectScanInput(input: {
  scanInput: ScanProjectInput;
  onProgress?: AnalysisProgressCallback;
  includeTraces?: boolean;
}): Promise<StaticAnalysisEngineProjectResult> {
  const progress = createAnalysisProgressReporter(input.onProgress);
  const snapshot = await runWorkspaceDiscoveryStage({
    scanInput: input.scanInput,
    progress,
  });
  const result = runAnalysisPipeline({
    workspaceDiscovery: snapshot,
    includeTraces: input.includeTraces ?? true,
    onProgress: (event) => progress(event.stage, event.status, event.message, event.durationMs),
  });

  return {
    snapshot,
    ...result,
  };
}

function runAnalysisPipeline(input: {
  workspaceDiscovery: ProjectSnapshot;
  onProgress?: AnalysisProgressCallback;
  includeTraces?: boolean;
}): StaticAnalysisEngineResult {
  const includeTraces = input.includeTraces ?? true;
  const progress = createAnalysisProgressReporter(input.onProgress);
  const frontends = runAnalysisStage(
    progress,
    "language-frontends",
    "Building language frontends",
    () => runLanguageFrontendsStage({ workspaceDiscovery: input.workspaceDiscovery }),
  );
  const factGraph = runAnalysisStage(progress, "fact-graph", "Building fact graph", () =>
    runFactGraphStage({
      workspaceDiscovery: input.workspaceDiscovery,
      frontends,
      includeTraces,
    }),
  );
  const symbolicEvaluationStage = runAnalysisStage(
    progress,
    "symbolic-evaluation",
    "Evaluating symbolic class expressions",
    () =>
      runSymbolicEvaluationStage({
        graph: factGraph.graph,
        includeTraces,
      }),
  );
  const renderStructureStage = runAnalysisStage(
    progress,
    "render-structure",
    "Building render structure",
    () =>
      runRenderStructureStage({
        factGraph,
        symbolicEvaluation: symbolicEvaluationStage,
        includeTraces,
      }),
  );
  const selectorReachabilityStage = runAnalysisStage(
    progress,
    "selector-reachability",
    "Building selector reachability evidence",
    () =>
      runSelectorReachabilityStage({
        renderStructure: renderStructureStage,
      }),
  );
  const projectEvidenceStage = runAnalysisStage(
    progress,
    "project-evidence",
    "Building project evidence",
    () =>
      runProjectEvidenceStage({
        projectInput: {
          factGraph,
          stylesheets: input.workspaceDiscovery.files.stylesheets,
          renderModel: renderStructureStage.renderModel,
          symbolicEvaluation: symbolicEvaluationStage,
          selectorReachability: selectorReachabilityStage.selectorReachability,
        },
        options: {
          includeTraces,
          cssModuleLocalsConvention: input.workspaceDiscovery.config.cssModules.localsConvention,
        },
      }),
  );
  const ownershipInferenceStage = runAnalysisStage(
    progress,
    "ownership-inference",
    "Building ownership inference",
    () =>
      runOwnershipInferenceStage({
        projectEvidence: projectEvidenceStage.projectEvidence,
        selectorReachability: selectorReachabilityStage.selectorReachability,
        includeTraces,
      }),
  );

  return {
    analysisEvidence: {
      projectEvidence: projectEvidenceStage.projectEvidence,
      selectorReachability: selectorReachabilityStage.selectorReachability,
      ownershipInference: ownershipInferenceStage.ownershipInference,
    },
  };
}

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
