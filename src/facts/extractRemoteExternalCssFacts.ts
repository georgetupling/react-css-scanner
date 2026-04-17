import { extractExternalCssFactsFromContent } from "./extractCssFacts.js";
import type { ExternalCssFact, HtmlFileFact } from "./types.js";

export async function extractRemoteExternalCssFacts(input: {
  htmlFacts: HtmlFileFact[];
  operationalWarnings: string[];
}): Promise<ExternalCssFact[]> {
  const remoteStylesheetHrefs = [
    ...new Set(
      input.htmlFacts
        .flatMap((htmlFact) => htmlFact.stylesheetLinks)
        .filter((stylesheetLink) => stylesheetLink.isRemote)
        .map((stylesheetLink) => stylesheetLink.href),
    ),
  ].sort((left, right) => left.localeCompare(right));

  const fetchResults = await Promise.all(
    remoteStylesheetHrefs.map(async (href) => {
      try {
        const response = await fetch(href);
        if (!response.ok) {
          input.operationalWarnings.push(
            `Could not fetch remote external CSS "${href}" (${response.status} ${response.statusText}); falling back to declared external CSS behavior.`,
          );
          return undefined;
        }

        const contentType = response.headers.get("content-type");
        if (contentType && !contentType.toLowerCase().includes("text/css")) {
          input.operationalWarnings.push(
            `Remote external CSS "${href}" returned unexpected content type "${contentType}"; falling back to declared external CSS behavior.`,
          );
          return undefined;
        }

        const content = await response.text();
        return extractExternalCssFactsFromContent({
          specifier: href,
          resolvedPath: href,
          content,
        });
      } catch (error) {
        const reason =
          error instanceof Error && error.message ? error.message : "unknown fetch failure";
        input.operationalWarnings.push(
          `Could not fetch remote external CSS "${href}" (${reason}); falling back to declared external CSS behavior.`,
        );
        return undefined;
      }
    }),
  );

  input.operationalWarnings.sort((left, right) => left.localeCompare(right));
  return fetchResults.filter((result): result is ExternalCssFact => result !== undefined);
}
