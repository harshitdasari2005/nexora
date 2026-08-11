# Changelog

All notable changes to `@nexora/config` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Environment loader** (`src/environment`) — typed parsing of process
  environment values: string, number, boolean, string array, number array.
  Every lookup is optional; requiredness is decided by the schema.
- **Configuration schema** (`src/schema`) — `ConfigKeyDefinition`,
  `ConfigSchemaMap`, per-key validation (`validateConfigValue`),
  whole-set validation (`validateConfigValues`), and `requiredKeys`.
- **Configuration validation** (`src/validation`) — `validateConfiguration`
  (type + requiredness gate) and `undeclaredKeys` for forward compatibility.
- **Configuration providers** (`src/providers`) — `ConfigProvider` contract,
  `staticProvider`, `environmentProvider`, `functionProvider`.
- **Configuration merging** (`src/merging`) — precedence-ordered layer merge
  (`mergeLayers`), winning-source resolution (`resolveSources`), and value
  equality (`configValuesEqual`).
- **Secrets interface** (`src/secrets`) — `Secrets` contract,
  `environmentSecrets`, `staticSecrets`, and `redactValue`.
- **Feature flags** (`src/feature-flags`) — `FeatureFlags` reader with
  safe defaults and source introspection.
- **Loader** (`src/loader`) — `loadConfiguration` / `loadConfigurationSync`;
  collects provider layers, merges by precedence, applies defaults, and
  validates the result.
- **Configuration manager** (`src/manager`) — `ConfigManager`: typed getters,
  runtime overrides (`setRuntimeValue` / `clearRuntimeValue`), change
  subscription, source introspection, and snapshot.
- **Core types** (`src/types`) — `ConfigValue`, `ConfigKey`, `ConfigSource`,
  `CONFIG_SOURCES` precedence, `ResolvedConfigEntry`, `ConfigChange`.

### Notes

- Configuration values are intentionally limited to JSON-compatible primitives
  and homogeneous arrays (BKD.md §11: configuration over customization).
- Runtime overrides are in-memory only; persistent settings are owned by the
  Configuration Platform, out of scope for this package.
