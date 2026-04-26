import { scanProject, type ScanProjectResult } from "../project/index.js";
import { parseArgs, printHelp } from "./args.js";
import { applyFocusFilter } from "./focus.js";
import { filterDiagnostics, filterFindings, formatTextReport } from "./formatter.js";
import { writeJsonReport } from "./jsonReport.js";
import { createCliProgressRenderer, shouldShowProgress, shouldUseColor } from "./progress.js";
import { CliUsageError, type CliArgs } from "./types.js";

export async function runCli(rawArgs: string[]): Promise<void> {
  const args = parseCliArgs(rawArgs);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const progressRenderer = createCliProgressRenderer({
    enabled: shouldShowProgress(args),
    stream: process.stderr,
    useColor: shouldUseColor(process.stderr),
  });

  let result: ScanProjectResult;
  try {
    result = await scanProject({
      rootDir: args.rootDir,
      configBaseDir: process.cwd(),
      configPath: args.configPath,
      onProgress: progressRenderer.onProgress,
      collectPerformance: args.timings,
      includeTraces: false,
    });
  } finally {
    progressRenderer.stop();
  }

  const focusedResult = applyFocusFilter(result, args.focusPaths);

  if (args.json) {
    await printJsonReport(focusedResult, args);
  } else {
    printTextReport(focusedResult, args);
  }

  process.exit(focusedResult.failed ? 1 : 0);
}

function parseCliArgs(rawArgs: string[]): CliArgs {
  try {
    return parseArgs(rawArgs);
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      console.error("");
      printHelp(process.stderr);
      process.exit(2);
    }

    throw error;
  }
}

async function printJsonReport(result: ScanProjectResult, args: CliArgs): Promise<void> {
  try {
    if (args.verbosity !== "medium") {
      console.warn("Warning: --verbosity has no effect with --json.");
    }
    const outputPath = await writeJsonReport({
      result,
      outputFile: args.outputFile,
      overwriteOutput: args.overwriteOutput,
      outputMinSeverity: args.outputMinSeverity,
    });
    console.log(`JSON report written to ${outputPath}`);
    console.log(`Failed: ${result.failed ? "yes" : "no"}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function printTextReport(result: ScanProjectResult, args: CliArgs): void {
  const visibleDiagnostics = filterDiagnostics(result.diagnostics, args.outputMinSeverity);
  const visibleFindings = filterFindings(result.findings, args.outputMinSeverity);

  console.log(
    formatTextReport({
      result,
      diagnostics: visibleDiagnostics,
      findings: visibleFindings,
      focusPaths: args.focusPaths,
      includeTimings: args.timings,
      verbosity: args.verbosity,
      useColor: shouldUseColor(process.stdout),
    }),
  );
}
