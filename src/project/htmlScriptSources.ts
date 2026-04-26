export type HtmlScriptSourceInput = {
  filePath: string;
  src: string;
  resolvedFilePath?: string;
  appRootPath?: string;
};

const SCRIPT_TAG_PATTERN = /<script\b[^>]*>/gi;
const SRC_ATTRIBUTE_PATTERN = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

export function extractHtmlScriptSources(input: {
  filePath: string;
  htmlText: string;
}): HtmlScriptSourceInput[] {
  const scriptSources: HtmlScriptSourceInput[] = [];

  for (const scriptTagMatch of input.htmlText.matchAll(SCRIPT_TAG_PATTERN)) {
    const scriptTag = scriptTagMatch[0];
    const srcMatch = SRC_ATTRIBUTE_PATTERN.exec(scriptTag);
    const src = srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3];
    if (!src) {
      continue;
    }

    scriptSources.push({
      filePath: input.filePath,
      src,
    });
  }

  return scriptSources.sort((left, right) =>
    `${left.filePath}:${left.src}`.localeCompare(`${right.filePath}:${right.src}`),
  );
}
