export type RuleSeverity = "off" | "info" | "warning" | "error";

export type ConfidenceLevel = "low" | "medium" | "high";

export type OwnershipNamingConvention = "off" | "sibling";

export type ExternalCssMode = "imported-only" | "declared-globals" | "fetch-remote";

export type ExternalCssGlobalProviderConfig = {
  provider: string;
  match: string[];
  classPrefixes: string[];
  classNames: string[];
};

export type RuleConfigObject = {
  severity: RuleSeverity;
  threshold?: number;
  minDeclarationOverlap?: number;
  minOccurrences?: number;
  minDeclarations?: number;
};

export type RuleConfigValue = RuleSeverity | RuleConfigObject;

export type RawReactCssScannerConfig = {
  $schema?: string;
  rootDir?: string;
  source?: {
    include?: string[];
    exclude?: string[];
  };
  css?: {
    global?: string[];
    utilities?: string[];
    modules?: {
      enabled?: boolean;
      patterns?: string[];
    };
  };
  ownership?: {
    pagePatterns?: string[];
    componentCssPatterns?: string[];
    namingConvention?: OwnershipNamingConvention;
  };
  externalCss?: {
    enabled?: boolean;
    mode?: ExternalCssMode;
    globals?: Array<{
      provider?: string;
      match?: string[];
      classPrefixes?: string[];
      classNames?: string[];
    }>;
  };
  classComposition?: {
    helpers?: string[];
  };
  policy?: {
    failOnSeverity?: Exclude<RuleSeverity, "off">;
  };
  rules?: Record<string, RuleConfigValue>;
};

export type ResolvedReactCssScannerConfig = {
  rootDir: string;
  source: {
    include: string[];
    exclude: string[];
    discovery: "auto" | "explicit";
  };
  css: {
    global: string[];
    utilities: string[];
    modules: {
      enabled: boolean;
      patterns: string[];
    };
  };
  ownership: {
    pagePatterns: string[];
    componentCssPatterns: string[];
    namingConvention: OwnershipNamingConvention;
  };
  externalCss: {
    enabled: boolean;
    mode: ExternalCssMode;
    globals: ExternalCssGlobalProviderConfig[];
  };
  classComposition: {
    helpers: string[];
  };
  policy: {
    failOnSeverity: Exclude<RuleSeverity, "off">;
  };
  rules: Record<string, RuleConfigValue>;
};

export const DEFAULT_CONFIG: ResolvedReactCssScannerConfig = {
  rootDir: ".",
  source: {
    include: [],
    exclude: ["dist", "build", "coverage", "node_modules"],
    discovery: "auto",
  },
  css: {
    global: [],
    utilities: ["**/utilities.css", "**/utilities/**/*.css"],
    modules: {
      enabled: true,
      patterns: ["**/*.module.css"],
    },
  },
  ownership: {
    pagePatterns: ["src/pages/**/*", "src/routes/**/*"],
    componentCssPatterns: [],
    namingConvention: "off",
  },
  externalCss: {
    enabled: true,
    mode: "declared-globals",
    globals: [
      {
        provider: "font-awesome",
        match: [
          "**/font-awesome/**/css/*.css",
          "**/fontawesome/**/css/*.css",
          "**/cdnjs.cloudflare.com/ajax/libs/font-awesome/**/css/*.css",
          "**/use.fontawesome.com/**.css",
        ],
        classPrefixes: ["fa-"],
        classNames: [
          "fa",
          "fa-solid",
          "fa-regular",
          "fa-brands",
          "fa-light",
          "fa-thin",
          "fa-duotone",
        ],
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
      },
    ],
  },
  classComposition: {
    helpers: ["classnames", "clsx"],
  },
  policy: {
    failOnSeverity: "error",
  },
  rules: {
    "component-css-should-be-global": {
      severity: "info",
      threshold: 8,
    },
    "repeated-style-pattern": {
      severity: "info",
      minOccurrences: 3,
      minDeclarations: 3,
    },
    "utility-class-replacement": {
      severity: "info",
      minDeclarationOverlap: 2,
    },
  },
};
