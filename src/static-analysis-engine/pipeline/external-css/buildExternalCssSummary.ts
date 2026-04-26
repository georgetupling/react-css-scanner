import type {
  ActiveExternalCssProvider,
  ExternalCssAnalysisInput,
  ExternalCssGlobalProviderConfig,
  ExternalCssSummary,
  HtmlScriptSourceInput,
  HtmlStylesheetLinkInput,
  PackageCssImportInput,
} from "./types.js";

export function buildExternalCssSummary(
  input: ExternalCssAnalysisInput | undefined,
): ExternalCssSummary {
  const fetchRemote = input?.fetchRemote ?? false;
  const htmlStylesheetLinks = normalizeHtmlStylesheetLinks(input?.htmlStylesheetLinks ?? []);
  const htmlScriptSources = normalizeHtmlScriptSources(input?.htmlScriptSources ?? []);
  const packageCssImports = normalizePackageCssImports(input?.packageCssImports ?? []);
  const globalProviders = normalizeGlobalProviders(input?.globalProviders ?? []);
  const activeProviders = buildActiveProviders({
    globalProviders,
    htmlStylesheetLinks,
  });

  return {
    enabled: true,
    fetchRemote,
    activeProviders,
    packageCssImports,
    projectWideEntrySources: collectProjectWideEntrySources(htmlScriptSources),
    projectWideStylesheetFilePaths: collectProjectWideStylesheetFilePaths({
      htmlStylesheetLinks,
      fetchRemote,
    }),
    externalStylesheetFilePaths: collectExternalStylesheetFilePaths({
      activeProviders,
      htmlStylesheetLinks,
      packageCssImports,
      fetchRemote,
    }),
  };
}

function buildActiveProviders(input: {
  globalProviders: ExternalCssGlobalProviderConfig[];
  htmlStylesheetLinks: HtmlStylesheetLinkInput[];
}): ActiveExternalCssProvider[] {
  const activeProviders = new Map<string, ActiveExternalCssProvider>();

  for (const stylesheetLink of input.htmlStylesheetLinks) {
    for (const provider of input.globalProviders) {
      if (
        !matchesAnyGlob(stylesheetLink.href, provider.match) &&
        !matchesOptionalPath(stylesheetLink.resolvedFilePath, provider.match)
      ) {
        continue;
      }

      upsertActiveProvider(activeProviders, provider, stylesheetLink);
    }
  }

  return [...activeProviders.values()].sort((left, right) =>
    left.provider.localeCompare(right.provider),
  );
}

function upsertActiveProvider(
  activeProviders: Map<string, ActiveExternalCssProvider>,
  provider: ExternalCssGlobalProviderConfig,
  matchedStylesheet: HtmlStylesheetLinkInput,
): void {
  const existingProvider = activeProviders.get(provider.provider);
  if (existingProvider) {
    existingProvider.match = uniqueSorted([...existingProvider.match, ...provider.match]);
    existingProvider.classPrefixes = uniqueSorted([
      ...existingProvider.classPrefixes,
      ...provider.classPrefixes,
    ]);
    existingProvider.classNames = uniqueSorted([
      ...existingProvider.classNames,
      ...provider.classNames,
    ]);
    existingProvider.matchedStylesheets = uniqueStylesheetLinks([
      ...existingProvider.matchedStylesheets,
      matchedStylesheet,
    ]);
    return;
  }

  activeProviders.set(provider.provider, {
    provider: provider.provider,
    match: uniqueSorted(provider.match),
    classPrefixes: uniqueSorted(provider.classPrefixes),
    classNames: uniqueSorted(provider.classNames),
    matchedStylesheets: [matchedStylesheet],
  });
}

function normalizeGlobalProviders(
  providers: ExternalCssGlobalProviderConfig[],
): ExternalCssGlobalProviderConfig[] {
  return providers
    .map((provider) => ({
      provider: provider.provider,
      match: [...provider.match],
      classPrefixes: [...provider.classPrefixes].sort((left, right) => left.localeCompare(right)),
      classNames: [...provider.classNames].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider));
}

function normalizeHtmlScriptSources(
  scriptSources: HtmlScriptSourceInput[],
): HtmlScriptSourceInput[] {
  return [...scriptSources]
    .map((scriptSource) => ({
      filePath: scriptSource.filePath.replace(/\\/g, "/"),
      src: scriptSource.src,
      ...(scriptSource.resolvedFilePath
        ? { resolvedFilePath: scriptSource.resolvedFilePath.replace(/\\/g, "/") }
        : {}),
      ...(scriptSource.appRootPath
        ? { appRootPath: scriptSource.appRootPath.replace(/\\/g, "/") }
        : {}),
    }))
    .sort((left, right) =>
      `${left.filePath}:${left.src}:${left.resolvedFilePath ?? ""}:${left.appRootPath ?? ""}`.localeCompare(
        `${right.filePath}:${right.src}:${right.resolvedFilePath ?? ""}:${right.appRootPath ?? ""}`,
      ),
    );
}

function normalizeHtmlStylesheetLinks(
  stylesheetLinks: HtmlStylesheetLinkInput[],
): HtmlStylesheetLinkInput[] {
  return [...stylesheetLinks]
    .map((stylesheetLink) => ({
      filePath: stylesheetLink.filePath.replace(/\\/g, "/"),
      href: stylesheetLink.href,
      isRemote: stylesheetLink.isRemote,
      ...(stylesheetLink.resolvedFilePath
        ? { resolvedFilePath: stylesheetLink.resolvedFilePath.replace(/\\/g, "/") }
        : {}),
    }))
    .sort(compareStylesheetLinks);
}

function normalizePackageCssImports(imports: PackageCssImportInput[]): PackageCssImportInput[] {
  const importsByKey = new Map<string, PackageCssImportInput>();
  for (const importRecord of imports) {
    const normalizedImport = {
      importerKind: importRecord.importerKind,
      importerFilePath: importRecord.importerFilePath.replace(/\\/g, "/"),
      specifier: importRecord.specifier,
      resolvedFilePath: importRecord.resolvedFilePath.replace(/\\/g, "/"),
    };
    importsByKey.set(
      `${normalizedImport.importerKind}:${normalizedImport.importerFilePath}:${normalizedImport.specifier}:${normalizedImport.resolvedFilePath}`,
      normalizedImport,
    );
  }

  return [...importsByKey.values()].sort((left, right) =>
    `${left.importerKind}:${left.importerFilePath}:${left.specifier}:${left.resolvedFilePath}`.localeCompare(
      `${right.importerKind}:${right.importerFilePath}:${right.specifier}:${right.resolvedFilePath}`,
    ),
  );
}

function compareStylesheetLinks(
  left: HtmlStylesheetLinkInput,
  right: HtmlStylesheetLinkInput,
): number {
  if (left.filePath === right.filePath) {
    return left.href.localeCompare(right.href);
  }

  return left.filePath.localeCompare(right.filePath);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueStylesheetLinks(
  stylesheetLinks: HtmlStylesheetLinkInput[],
): HtmlStylesheetLinkInput[] {
  const linksByKey = new Map<string, HtmlStylesheetLinkInput>();
  for (const stylesheetLink of stylesheetLinks) {
    linksByKey.set(
      `${stylesheetLink.filePath}:${stylesheetLink.href}:${stylesheetLink.resolvedFilePath ?? ""}`,
      stylesheetLink,
    );
  }
  return [...linksByKey.values()].sort(compareStylesheetLinks);
}

function collectProjectWideEntrySources(
  scriptSources: HtmlScriptSourceInput[],
): ExternalCssSummary["projectWideEntrySources"] {
  const entrySourcesByKey = new Map<
    string,
    ExternalCssSummary["projectWideEntrySources"][number]
  >();

  for (const scriptSource of scriptSources) {
    if (!scriptSource.resolvedFilePath) {
      continue;
    }

    const entrySource = {
      entrySourceFilePath: scriptSource.resolvedFilePath,
      appRootPath: scriptSource.appRootPath ?? ".",
    };
    entrySourcesByKey.set(
      `${entrySource.entrySourceFilePath}:${entrySource.appRootPath}`,
      entrySource,
    );
  }

  return [...entrySourcesByKey.values()].sort(
    (left, right) =>
      left.entrySourceFilePath.localeCompare(right.entrySourceFilePath) ||
      left.appRootPath.localeCompare(right.appRootPath),
  );
}

function collectProjectWideStylesheetFilePaths(input: {
  htmlStylesheetLinks: HtmlStylesheetLinkInput[];
  fetchRemote: boolean;
}): string[] {
  const projectWideStylesheetFilePaths = new Set<string>();

  for (const stylesheetLink of input.htmlStylesheetLinks) {
    if (stylesheetLink.resolvedFilePath) {
      projectWideStylesheetFilePaths.add(stylesheetLink.resolvedFilePath);
    }
  }

  if (input.fetchRemote) {
    for (const stylesheetLink of input.htmlStylesheetLinks) {
      if (stylesheetLink.isRemote) {
        projectWideStylesheetFilePaths.add(stylesheetLink.href);
      }
    }
  }

  return [...projectWideStylesheetFilePaths].sort((left, right) => left.localeCompare(right));
}

function collectExternalStylesheetFilePaths(input: {
  activeProviders: ActiveExternalCssProvider[];
  htmlStylesheetLinks: HtmlStylesheetLinkInput[];
  packageCssImports: PackageCssImportInput[];
  fetchRemote: boolean;
}): string[] {
  const externalStylesheetFilePaths = new Set<string>();

  for (const provider of input.activeProviders) {
    for (const stylesheetLink of provider.matchedStylesheets) {
      externalStylesheetFilePaths.add(stylesheetLink.resolvedFilePath ?? stylesheetLink.href);
    }
  }

  for (const importRecord of input.packageCssImports) {
    externalStylesheetFilePaths.add(importRecord.resolvedFilePath);
  }

  if (input.fetchRemote) {
    for (const stylesheetLink of input.htmlStylesheetLinks) {
      if (stylesheetLink.isRemote) {
        externalStylesheetFilePaths.add(stylesheetLink.href);
      }
    }
  }

  return [...externalStylesheetFilePaths].sort((left, right) => left.localeCompare(right));
}

function matchesOptionalPath(value: string | undefined, patterns: readonly string[]): boolean {
  return value ? matchesAnyGlob(value, patterns) : false;
}

function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  const normalizedValue = normalizePathForMatch(value);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalizedValue));
}

function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, "/");
}

function globToRegExp(globPattern: string): RegExp {
  const normalizedPattern = normalizePathForMatch(globPattern);
  let pattern = "^";

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const nextChar = normalizedPattern[index + 1];
    const nextNextChar = normalizedPattern[index + 2];

    if (char === "*") {
      if (nextChar === "*") {
        if (nextNextChar === "/") {
          pattern += "(?:.*/)?";
          index += 2;
        } else {
          pattern += ".*";
          index += 1;
        }
      } else {
        pattern += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      pattern += ".";
      continue;
    }

    if ("/.+^${}()|[]\\".includes(char)) {
      pattern += `\\${char}`;
      continue;
    }

    pattern += char;
  }

  pattern += "$";
  return new RegExp(pattern);
}
