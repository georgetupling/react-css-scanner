import type { HtmlStylesheetLinkInput } from "../static-analysis-engine/index.js";

const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;
const ATTRIBUTE_PATTERN = /([^\s=/"'>]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi;

export function extractHtmlStylesheetLinks(input: {
  filePath: string;
  htmlText: string;
}): HtmlStylesheetLinkInput[] {
  const links: HtmlStylesheetLinkInput[] = [];

  for (const linkTagMatch of input.htmlText.matchAll(LINK_TAG_PATTERN)) {
    const attributes = parseAttributes(linkTagMatch[0]);
    const rel = attributes.get("rel");
    const href = attributes.get("href");
    if (!rel || !href || !isStylesheetRel(rel)) {
      continue;
    }

    links.push({
      filePath: input.filePath,
      href: normalizeHrefForMatching(href),
      isRemote: isRemoteHref(href),
    });
  }

  return links.sort((left, right) =>
    `${left.filePath}:${left.href}`.localeCompare(`${right.filePath}:${right.href}`),
  );
}

function parseAttributes(tagText: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const attributeMatch of tagText.matchAll(ATTRIBUTE_PATTERN)) {
    const [, rawName, rawValue] = attributeMatch;
    if (!rawName || !rawValue) {
      continue;
    }

    attributes.set(rawName.toLowerCase(), stripQuotes(rawValue));
  }
  return attributes;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isStylesheetRel(rel: string): boolean {
  return rel
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .includes("stylesheet");
}

function normalizeHrefForMatching(href: string): string {
  return href.split(/[?#]/, 1)[0] ?? href;
}

function isRemoteHref(href: string): boolean {
  return /^(?:https?:)?\/\//i.test(href);
}
