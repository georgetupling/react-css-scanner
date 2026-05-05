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
    const includeTraces = true;
    result = await scanProject({
      rootDir: args.rootDir,
      configBaseDir: process.cwd(),
      configPath: args.configPath,
      ignore: {
        classNames: args.ignoreClassNames,
        filePaths: args.ignoreFilePaths,
      },
      onProgress: progressRenderer.onProgress,
      collectPerformance: args.timings,
      includeTraces,
      includeDebugRuntimeCss: args.debugRuntimeCss,
    });
  } finally {
    progressRenderer.stop();
  }

  const focusedResult = applyFocusFilter(result, args.focusPaths);
  const useJson = args.json || focusedResult.config.reporting.json;
  const includeJsonTraces = args.trace || focusedResult.config.reporting.trace;
  const includeRuntimeCssDebug =
    args.debugRuntimeCss || focusedResult.config.reporting.debugRuntimeCss;
  const overwriteOutput = args.overwriteOutput || focusedResult.config.reporting.overwriteOutput;

  if (!useJson && (args.trace || args.debugRuntimeCss || args.outputFile || args.overwriteOutput)) {
    printCliUsageError(
      args.trace
        ? "--trace requires JSON output. Enable --json or set reporting.json=true in scan-react-css.json."
        : args.debugRuntimeCss
          ? "--debug-runtime-css requires JSON output. Enable --json or set reporting.json=true in scan-react-css.json."
          : "--output-file and --overwrite-output require JSON output. Enable --json or set reporting.json=true in scan-react-css.json.",
    );
  }

  if (useJson) {
    await printJsonReport(focusedResult, {
      ...args,
      trace: includeJsonTraces,
      debugRuntimeCss: includeRuntimeCssDebug,
      overwriteOutput,
    });
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
      printCliUsageError(error.message);
    }

    throw error;
  }
}

function printCliUsageError(message: string): never {
  console.error(message);
  console.error("");
  printHelp(process.stderr);
  process.exit(2);
}

async function printJsonReport(result: ScanProjectResult, args: CliArgs): Promise<void> {
  try {
    const outputPath = await writeJsonReport({
      result,
      outputFile: args.outputFile,
      outputDirectory: result.config.reporting.outputDirectory,
      overwriteOutput: args.overwriteOutput,
      outputMinSeverity: args.outputMinSeverity,
      includeTraces: args.trace,
      includeRuntimeCssDebug: args.debugRuntimeCss,
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

  const verbose = args.verbose || result.config.reporting.verbose;
  console.log(
    formatTextReport({
      result,
      diagnostics: visibleDiagnostics,
      findings: visibleFindings,
      focusPaths: args.focusPaths,
      includeTimings: args.timings,
      verbose,
      useColor: shouldUseColor(process.stdout),
    }),
  );
}
