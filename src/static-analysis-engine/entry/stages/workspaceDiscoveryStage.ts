import { buildProjectSnapshot } from "../../pipeline/workspace-discovery/index.js";
import type { ProjectSnapshot } from "../../pipeline/workspace-discovery/index.js";
import type { ScanProjectInput } from "../../../project/types.js";

export async function runWorkspaceDiscoveryStage(input: {
  scanInput: ScanProjectInput;
  progress: (
    stage: string,
    status: "started" | "completed",
    message: string,
    durationMs?: number,
  ) => void;
}): Promise<ProjectSnapshot> {
  return buildProjectSnapshot({
    scanInput: input.scanInput,
    rootDir: input.scanInput.rootDir,
    runStage: (stage, message, run) => runAsyncAnalysisStage(input.progress, stage, message, run),
  });
}

async function runAsyncAnalysisStage<T>(
  progress: (
    stage: string,
    status: "started" | "completed",
    message: string,
    durationMs?: number,
  ) => void,
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
