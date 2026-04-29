export {
  buildLanguageFrontends,
  buildSourceFrontendFactsFromParsedFiles,
} from "./buildLanguageFrontends.js";
export { languageFrontendsToEngineInput } from "./adapters/languageFrontendsToEngineInput.js";
export type { SourceModuleSyntaxFacts } from "./source/moduleSyntax.js";
export type {
  CssFrontendFacts,
  CssFrontendFile,
  LanguageFrontendsCompatibility,
  LanguageFrontendsInput,
  LanguageFrontendsResult,
  RuntimeDomClassSite,
  RuntimeDomClassSiteKind,
  RuntimeDomLibraryHint,
  SourceFrontendFacts,
  SourceFrontendFile,
  SourceLanguageKind,
} from "./types.js";
