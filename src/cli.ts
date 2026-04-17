#!/usr/bin/env node

import { scanReactCss } from "./index.js";
import { formatHumanReadableOutput, formatJsonOutput } from "./cli/format.js";
import { CliArgumentError, parseCliArgs } from "./cli/parseArgs.js";
import { writeOutputFile } from "./cli/output.js";

void runCli(process.argv);

export async function runCli(argv: string[]): Promise<void> {
  try {
    const parsedArgs = parseCliArgs(argv);
    const result = await scanReactCss({
      targetPath: parsedArgs.targetPath,
      configPath: parsedArgs.configPath,
    });

    for (const warning of result.operationalWarnings ?? []) {
      console.warn(`Warning: ${warning}`);
    }

    if (parsedArgs.json) {
      const content = formatJsonOutput(result, parsedArgs.configSummary);

      if (parsedArgs.outputFile) {
        const writtenPath = await writeOutputFile({
          filePath: parsedArgs.outputFile,
          content,
          overwrite: parsedArgs.overwriteOutput,
        });
        console.log(writtenPath);
      } else {
        console.log(content);
      }
    } else {
      const output = formatHumanReadableOutput({
        result,
        outputMode: parsedArgs.outputMode,
        minSeverity: parsedArgs.outputMinSeverity,
        scanTarget: parsedArgs.targetPath ?? process.cwd(),
      });
      console.log(output);
    }

    process.exitCode = shouldFailFromPolicy(result) ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CLI failure occurred.";
    if (error instanceof CliArgumentError) {
      console.error(message);
      process.exitCode = 1;
      return;
    }

    console.error(message);
    process.exitCode = 1;
  }
}

function shouldFailFromPolicy(result: Awaited<ReturnType<typeof scanReactCss>>): boolean {
  const threshold = result.config.policy.failOnSeverity;

  if (threshold === "error") {
    return result.summary.errorCount > 0;
  }

  if (threshold === "warning") {
    return result.summary.errorCount > 0 || result.summary.warningCount > 0;
  }

  return (
    result.summary.errorCount > 0 || result.summary.warningCount > 0 || result.summary.infoCount > 0
  );
}
