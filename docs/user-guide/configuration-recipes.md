# Configuration Recipes

This page shows practical starter configs for common project setups.

## Standard `src` App

```json
{
  "css": {
    "global": ["src/styles/global.css"]
  }
}
```

## Monorepo App

```json
{
  "rootDir": ".",
  "source": {
    "include": ["packages/web/src"]
  },
  "css": {
    "global": ["packages/web/src/styles/global.css"]
  }
}
```

## Strict CI

Fail on warnings and errors:

```json
{
  "policy": {
    "failOnSeverity": "warning"
  }
}
```

Fail on any finding:

```json
{
  "policy": {
    "failOnSeverity": "info"
  }
}
```

## Component-Heavy App With Colocated CSS

```json
{
  "ownership": {
    "componentCssPatterns": ["src/components/**/*.css"],
    "namingConvention": "sibling"
  }
}
```

## Project With Custom CSS Module Naming

```json
{
  "css": {
    "modules": {
      "enabled": true,
      "patterns": ["**/*.module.css", "**/*.m.css"]
    }
  }
}
```

## Project With Utility CSS

```json
{
  "css": {
    "utilities": ["src/styles/utilities.css", "src/styles/tokens/**/*.css"]
  }
}
```

## Project With Wrapped Classname Helper

```json
{
  "classComposition": {
    "helpers": ["classnames", "clsx", "cn"]
  }
}
```

## Turning Rules Off Or Down

Turn off a noisy advisory rule:

```json
{
  "rules": {
    "global-css-not-global": "off"
  }
}
```

Lower a rule to info:

```json
{
  "rules": {
    "duplicate-css-class-definition": "info"
  }
}
```

## Rule Threshold Examples

```json
{
  "rules": {
    "component-css-should-be-global": {
      "severity": "info",
      "threshold": 10
    },
    "utility-class-replacement": {
      "severity": "info",
      "maxUtilityClasses": 3
    },
    "repeated-style-pattern": {
      "severity": "info",
      "minOccurrences": 4,
      "minDeclarations": 4
    }
  }
}
```

For the full option-by-option reference, see [Configuration Reference](./configuration-reference.md).
