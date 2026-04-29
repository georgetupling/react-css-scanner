export {
  buildLanguageFrontends,
  buildSourceFrontendFactsFromSourceFiles,
  buildSourceFrontendFactsFromParsedFiles,
} from "./buildLanguageFrontends.js";
export type { SourceModuleSyntaxFacts } from "./source/module-syntax/index.js";
export type {
  ReactClassExpressionSiteFact,
  ReactComponentDeclarationFact,
  ReactElementTemplateFact,
  ReactRenderSiteFact,
  SourceReactSyntaxFacts,
} from "./source/react-syntax/index.js";
export type {
  CssFrontendFacts,
  CssFrontendFile,
  LanguageFrontendsInput,
  LanguageFrontendsResult,
  RuntimeDomClassSite,
  RuntimeDomClassSiteKind,
  RuntimeDomLibraryHint,
  SourceFrontendFacts,
  SourceFrontendFile,
  SourceLanguageKind,
} from "./types.js";
