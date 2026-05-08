import { DEFAULT_RULE_SEVERITIES } from "../rules/catalogue.js";
import { cloneExternalCssGlobals } from "./cloneConfig.js";
import type { ExternalCssGlobalProviderConfig, ScannerConfig } from "./types.js";

export const DEFAULT_EXTERNAL_CSS_GLOBALS: ExternalCssGlobalProviderConfig[] = [
  {
    provider: "font-awesome",
    match: [
      "**/@fortawesome/fontawesome-free/css/*.css",
      "**/font-awesome/**/css/*.css",
      "**/fontawesome/**/css/*.css",
      "**/cdnjs.cloudflare.com/ajax/libs/font-awesome/**/css/*.css",
      "**/use.fontawesome.com/**.css",
    ],
    classPrefixes: ["fa-"],
    classNames: ["fa", "fa-solid", "fa-regular", "fa-brands", "fa-light", "fa-thin", "fa-duotone"],
    stylesheetRole: "external-global",
  },
  {
    provider: "material-design-icons",
    match: [
      "**/@mdi/font@*/css/materialdesignicons*.css",
      "**/npm/@mdi/font@*/css/materialdesignicons*.css",
      "**/unpkg.com/@mdi/font@*/css/materialdesignicons*.css",
      "**/materialdesignicons*.css",
    ],
    classPrefixes: ["mdi-"],
    classNames: ["mdi", "mdi-set"],
    stylesheetRole: "external-global",
  },
  {
    provider: "bootstrap-icons",
    match: [
      "**/bootstrap-icons@*/font/bootstrap-icons*.css",
      "**/npm/bootstrap-icons@*/font/bootstrap-icons*.css",
      "**/unpkg.com/bootstrap-icons@*/font/bootstrap-icons*.css",
      "**/bootstrap-icons/font/bootstrap-icons*.css",
    ],
    classPrefixes: ["bi-"],
    classNames: ["bi"],
    stylesheetRole: "external-global",
  },
  {
    provider: "animate.css",
    match: [
      "**/cdnjs.cloudflare.com/ajax/libs/animate.css/**/animate*.css",
      "**/animate.css@*/animate*.css",
      "**/npm/animate.css@*/animate*.css",
      "**/animate.css/**/animate*.css",
    ],
    classPrefixes: ["animate__"],
    classNames: ["animate__animated"],
    stylesheetRole: "external-global",
  },
  {
    provider: "uikit",
    match: [
      "**/uikit@*/dist/css/uikit*.css",
      "**/npm/uikit@*/dist/css/uikit*.css",
      "**/unpkg.com/uikit@*/dist/css/uikit*.css",
      "**/uikit/dist/css/uikit*.css",
    ],
    classPrefixes: ["uk-"],
    classNames: [],
    stylesheetRole: "external-global",
  },
  {
    provider: "pure.css",
    match: [
      "**/purecss@*/build/pure*.css",
      "**/npm/purecss@*/build/pure*.css",
      "**/unpkg.com/purecss@*/build/pure*.css",
      "**/purecss/build/pure*.css",
    ],
    classPrefixes: ["pure-"],
    classNames: [],
    stylesheetRole: "external-global",
  },
  {
    provider: "tinymce",
    match: [
      "**/tinymce/**/skin*.css",
      "**/tinymce/**/content*.css",
      "**/tinymce/skins/**/*.css",
      "**/public/vendors/tinymce/**/*.css",
      "**/node_modules/tinymce/**/*.css",
    ],
    classPrefixes: ["tox-", "mce-", "ephox-"],
    classNames: ["tox", "mce-content-body"],
    stylesheetRole: "third-party-runtime",
  },
  {
    provider: "codemirror",
    match: [
      "**/codemirror/**/*.css",
      "**/@codemirror/**/*.css",
      "**/node_modules/codemirror/**/*.css",
      "**/node_modules/@codemirror/**/*.css",
    ],
    classPrefixes: ["cm-", "CodeMirror-"],
    classNames: ["CodeMirror", "cm-editor"],
    stylesheetRole: "third-party-runtime",
  },
  {
    provider: "prosemirror",
    match: [
      "**/prosemirror*/**/*.css",
      "**/prosemirror-view/**/*.css",
      "**/node_modules/prosemirror*/**/*.css",
      "**/node_modules/prosemirror-view/**/*.css",
    ],
    classPrefixes: ["ProseMirror-"],
    classNames: ["ProseMirror", "column-resize-handle", "selectedCell"],
    stylesheetRole: "third-party-runtime",
  },
];

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  failOnSeverity: "error",
  rules: {
    ...DEFAULT_RULE_SEVERITIES,
  },
  cssModules: {
    localsConvention: "camelCase",
  },
  externalCss: {
    fetchRemote: false,
    globals: cloneExternalCssGlobals(DEFAULT_EXTERNAL_CSS_GLOBALS),
    remoteTimeoutMs: 5_000,
  },
  ownership: {
    sharedCss: [],
    sharingPolicy: "balanced",
  },
  discovery: {
    sourceRoots: [],
    exclude: [],
    publicRoots: ["public"],
    aliases: {},
    stylesheetExtensions: [".css", ".less", ".sass", ".scss"],
  },
  ignore: {
    classNames: [],
    filePaths: [],
  },
  reporting: {
    verbose: false,
    json: false,
    trace: false,
    debugRuntimeCss: false,
    outputDirectory: undefined,
    overwriteOutput: false,
  },
};
