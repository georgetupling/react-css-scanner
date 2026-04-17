# Configuration Reference

This page lists every supported configuration option in `react-css-scanner.json`.

## Top-Level Shape

```json
{
  "$schema": "./node_modules/react-css-scanner/schema.json",
  "rootDir": ".",
  "source": {
    "include": ["src"],
    "exclude": ["dist", "build", "coverage", "node_modules"]
  },
  "css": {
    "global": [],
    "utilities": ["**/utilities.css", "**/utilities/**/*.css"],
    "modules": {
      "enabled": true,
      "patterns": ["**/*.module.css"]
    }
  },
  "ownership": {
    "pagePatterns": ["src/pages/**/*", "src/routes/**/*"],
    "componentCssPatterns": [],
    "namingConvention": "off"
  },
  "externalCss": {
    "enabled": true,
    "mode": "declared-globals"
  },
  "classComposition": {
    "helpers": ["classnames", "clsx"]
  },
  "policy": {
    "failOnSeverity": "error"
  },
  "rules": {}
}
```

## `$schema`

Type: `string`

Required: no

Example:

```json
{
  "$schema": "./node_modules/react-css-scanner/schema.json"
}
```

## `rootDir`

Type: `string`

Default:

```json
"."
```

Example:

```json
{
  "rootDir": "packages/web"
}
```

## `source`

Type: `object`

### `source.include`

Type: `string[]`

Default:

```json
["src"]
```

Example:

```json
{
  "source": {
    "include": ["src", "packages/app/src"]
  }
}
```

### `source.exclude`

Type: `string[]`

Default:

```json
["dist", "build", "coverage", "node_modules"]
```

Example:

```json
{
  "source": {
    "exclude": ["dist", "coverage", "**/*.stories.tsx", "**/*.test.tsx"]
  }
}
```

## `css`

Type: `object`

### `css.global`

Type: `string[]`

Default:

```json
[]
```

Example:

```json
{
  "css": {
    "global": ["src/styles/global.css", "src/styles/reset/**/*.css"]
  }
}
```

### `css.utilities`

Type: `string[]`

Default:

```json
["**/utilities.css", "**/utilities/**/*.css"]
```

Example:

```json
{
  "css": {
    "utilities": ["src/styles/utilities.css", "src/styles/tokens/**/*.css"]
  }
}
```

### `css.modules`

Type: `object`

#### `css.modules.enabled`

Type: `boolean`

Default:

```json
true
```

Example:

```json
{
  "css": {
    "modules": {
      "enabled": false
    }
  }
}
```

#### `css.modules.patterns`

Type: `string[]`

Default:

```json
["**/*.module.css"]
```

Example:

```json
{
  "css": {
    "modules": {
      "patterns": ["**/*.module.css", "**/*.m.css"]
    }
  }
}
```

## `ownership`

Type: `object`

### `ownership.pagePatterns`

Type: `string[]`

Default:

```json
["src/pages/**/*", "src/routes/**/*"]
```

Example:

```json
{
  "ownership": {
    "pagePatterns": ["app/routes/**/*", "src/screens/**/*"]
  }
}
```

### `ownership.componentCssPatterns`

Type: `string[]`

Default:

```json
[]
```

Example:

```json
{
  "ownership": {
    "componentCssPatterns": ["src/components/**/*.css", "src/ui/**/*.module.css"]
  }
}
```

### `ownership.namingConvention`

Type: `"off" | "sibling"`

Default:

```json
"off"
```

Example:

```json
{
  "ownership": {
    "namingConvention": "sibling"
  }
}
```

## `externalCss`

Type: `object`

### `externalCss.enabled`

Type: `boolean`

Default:

```json
true
```

Example:

```json
{
  "externalCss": {
    "enabled": false
  }
}
```

### `externalCss.mode`

Type: `"imported-only" | "declared-globals" | "fetch-remote"`

Default:

```json
"declared-globals"
```

`"imported-only"` limits external CSS modeling to explicit source imports.

`"declared-globals"` also allows matching HTML-linked stylesheets to activate declared global providers such as the built-in Font Awesome preset.

`"fetch-remote"` includes declared-global behavior and also fetches matching remote HTML-linked stylesheets directly so their real class definitions can be indexed for that scan.

### `externalCss.globals`

Type: `Array<{ provider: string; match: string[]; classPrefixes: string[]; classNames: string[] }>`

Default:

- built-in provider presets for Font Awesome, Bootstrap Icons, Material Design Icons, Animate.css, UIkit, and Pure.css

Example:

```json
{
  "externalCss": {
    "globals": [
      {
        "provider": "font-awesome",
        "match": ["**/cdnjs.cloudflare.com/ajax/libs/font-awesome/**/css/*.css"],
        "classPrefixes": ["fa-"],
        "classNames": ["fa", "fa-solid", "fa-regular", "fa-brands"]
      }
    ]
  }
}
```

These entries are matched against HTML stylesheet URLs or paths using glob matching.

## `classComposition`

Type: `object`

### `classComposition.helpers`

Type: `string[]`

Default:

```json
["classnames", "clsx"]
```

Example:

```json
{
  "classComposition": {
    "helpers": ["classnames", "clsx", "cn"]
  }
}
```

## `policy`

Type: `object`

### `policy.failOnSeverity`

Type: `"info" | "warning" | "error"`

Default:

```json
"error"
```

Examples:

```json
{
  "policy": {
    "failOnSeverity": "warning"
  }
}
```

```json
{
  "policy": {
    "failOnSeverity": "info"
  }
}
```

## `rules`

Type: `Record<string, RuleConfigValue>`

Each rule can use either:

- a shorthand severity string
- an object with `severity` and optional numeric settings

### Shorthand values

- `"off"`
- `"info"`
- `"warning"`
- `"error"`

### Rule object fields

- `severity`
- `threshold`
- `minDeclarationOverlap`
- `minOccurrences`
- `minDeclarations`

### Example: shorthand

```json
{
  "rules": {
    "missing-css-class": "error",
    "unused-css-class": "warning",
    "global-css-not-global": "off"
  }
}
```

### Example: object form

```json
{
  "rules": {
    "component-css-should-be-global": {
      "severity": "info",
      "threshold": 10
    },
    "utility-class-replacement": {
      "severity": "info",
      "minDeclarationOverlap": 3
    },
    "repeated-style-pattern": {
      "severity": "info",
      "minOccurrences": 4,
      "minDeclarations": 4
    }
  }
}
```

### Implemented rule IDs

- `missing-css-class`
- `unreachable-css`
- `unused-css-class`
- `component-style-cross-component`
- `global-css-not-global`
- `utility-class-replacement`
- `dynamic-class-reference`
- `missing-css-module-class`
- `page-style-used-by-single-component`
- `dynamic-missing-css-class`
- `unused-css-module-class`
- `missing-external-css-class`
- `duplicate-css-class-definition`
- `component-css-should-be-global`
