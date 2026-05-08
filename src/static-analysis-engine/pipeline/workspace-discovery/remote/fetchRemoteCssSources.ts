import type { ScanDiagnostic } from "../../../../project/types.js";
import type { HtmlStylesheetLinkFact } from "../types.js";

export async function fetchRemoteCssSources(input: {
  htmlStylesheetLinks: HtmlStylesheetLinkFact[];
  remoteTimeoutMs: number;
  diagnostics: ScanDiagnostic[];
}): Promise<Array<{ filePath: string; cssText: string }>> {
  const remoteLinksByHref = new Map<string, HtmlStylesheetLinkFact>();
  for (const stylesheetLink of input.htmlStylesheetLinks) {
    if (stylesheetLink.isRemote) {
      remoteLinksByHref.set(stylesheetLink.href, stylesheetLink);
    }
  }

  const cssSources = await Promise.all(
    [...remoteLinksByHref.values()].map((stylesheetLink) =>
      fetchRemoteCssSource({
        stylesheetLink,
        remoteTimeoutMs: input.remoteTimeoutMs,
        diagnostics: input.diagnostics,
      }),
    ),
  );

  return cssSources
    .filter((cssSource): cssSource is { filePath: string; cssText: string } => Boolean(cssSource))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function fetchRemoteCssSource(input: {
  stylesheetLink: HtmlStylesheetLinkFact;
  remoteTimeoutMs: number;
  diagnostics: ScanDiagnostic[];
}): Promise<{ filePath: string; cssText: string } | undefined> {
  if (typeof globalThis.fetch !== "function") {
    input.diagnostics.push({
      code: "loading.remote-css-fetch-unavailable",
      severity: "debug",
      phase: "loading",
      filePath: input.stylesheetLink.filePath,
      message: `failed to fetch remote CSS "${input.stylesheetLink.href}" from ${input.stylesheetLink.filePath}: fetch is not available in this runtime`,
    });
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.remoteTimeoutMs);
  try {
    const response = await globalThis.fetch(toFetchUrl(input.stylesheetLink.href), {
      signal: controller.signal,
    });
    if (!response.ok) {
      input.diagnostics.push({
        code: "loading.remote-css-fetch-failed",
        severity: "debug",
        phase: "loading",
        filePath: input.stylesheetLink.filePath,
        message: `failed to fetch remote CSS "${input.stylesheetLink.href}" from ${input.stylesheetLink.filePath}: HTTP ${response.status}`,
      });
      return undefined;
    }

    return {
      filePath: input.stylesheetLink.href,
      cssText: await response.text(),
    };
  } catch (error) {
    input.diagnostics.push({
      code:
        error instanceof Error && error.name === "AbortError"
          ? "loading.remote-css-fetch-timeout"
          : "loading.remote-css-fetch-failed",
      severity: "debug",
      phase: "loading",
      filePath: input.stylesheetLink.filePath,
      message: `failed to fetch remote CSS "${input.stylesheetLink.href}" from ${input.stylesheetLink.filePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function toFetchUrl(href: string): string {
  return href.startsWith("//") ? `https:${href}` : href;
}
