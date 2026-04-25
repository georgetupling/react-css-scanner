#!/usr/bin/env node
import { scanProject } from "./project/index.js";
import type { AnalysisTrace } from "./static-analysis-engine/index.js";
import type { Finding } from "./rules/index.js";
import type { ScanDiagnostic, ScanProjectResult } from "./project/index.js";

type CliArgs = {
  rootDir?: string;
  configPath?: string;
  json: boolean;
  trace: boolean;
  help: boolean;
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const result = await scanProject({
  rootDir: args.rootDir,
  configPath: args.configPath,
});

if (args.json) {
  console.log(JSON.stringify(formatJsonResult(result, args.trace), null, 2));
} else {
  const visibleDiagnostics = filterDiagnostics(result.diagnostics, args.trace);
  const visibleFindings = filterFindings(result.findings, args.trace);

  console.log(`scan-react-css reboot scan`);
  console.log(`Root: ${result.rootDir}`);
  console.log(`Source files: ${result.summary.sourceFileCount}`);
  console.log(`CSS files: ${result.summary.cssFileCount}`);
  console.log(`Findings: ${visibleFindings.length}`);
  console.log(`Failed: ${result.failed ? "yes" : "no"}`);
  console.log(`Fail on severity: ${result.config.failOnSeverity}`);
  console.log(`Class references: ${result.summary.classReferenceCount}`);
  console.log(`Class definitions: ${result.summary.classDefinitionCount}`);
  console.log(`Selector queries: ${result.summary.selectorQueryCount}`);

  for (const diagnostic of visibleDiagnostics) {
    console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
  }

  for (const finding of visibleFindings) {
    const location = finding.location
      ? ` (${finding.location.filePath}:${finding.location.startLine})`
      : "";
    console.log(`[${finding.severity}] ${finding.ruleId}: ${finding.message}${location}`);
    if (args.trace) {
      for (const trace of finding.traces) {
        printTrace(trace, "  ");
      }
    }
  }
}

process.exit(result.failed ? 1 : 0);

function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = {
    json: false,
    trace: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--config") {
      args.configPath = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--trace" || arg === "--debug") {
      args.trace = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (!args.rootDir) {
      args.rootDir = arg;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`Usage: scan-react-css [rootDir] [--config path] [--json] [--trace]`);
}

function formatJsonResult(result: ScanProjectResult, includeDebug: boolean): object {
  return {
    rootDir: result.rootDir,
    config: {
      source: result.config.source,
      failOnSeverity: result.config.failOnSeverity,
      rules: result.config.rules,
    },
    diagnostics: filterDiagnostics(result.diagnostics, includeDebug),
    findings: filterFindings(result.findings, includeDebug),
    summary: includeDebug ? result.summary : withoutDebugCounts(result.summary),
    failed: result.failed,
  };
}

function filterDiagnostics(diagnostics: ScanDiagnostic[], includeDebug: boolean): ScanDiagnostic[] {
  return includeDebug
    ? diagnostics
    : diagnostics.filter((diagnostic) => diagnostic.severity !== "debug");
}

function filterFindings(findings: Finding[], includeDebug: boolean): Finding[] {
  return includeDebug ? findings : findings.filter((finding) => finding.severity !== "debug");
}

function withoutDebugCounts(summary: ScanProjectResult["summary"]): ScanProjectResult["summary"] {
  return {
    ...summary,
    findingCount: summary.findingCount - summary.findingsBySeverity.debug,
    findingsBySeverity: {
      ...summary.findingsBySeverity,
      debug: 0,
    },
    diagnosticCount: summary.diagnosticCount - summary.diagnosticsBySeverity.debug,
    diagnosticsBySeverity: {
      ...summary.diagnosticsBySeverity,
      debug: 0,
    },
  };
}

function printTrace(trace: AnalysisTrace, indent: string): void {
  console.log(`${indent}- ${trace.summary}`);
  for (const child of trace.children) {
    printTrace(child, `${indent}  `);
  }
}
