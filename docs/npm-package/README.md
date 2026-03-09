# @diodeinc/edatasheet

`@diodeinc/edatasheet` is a dual-purpose npm package:

- a CLI for validating Electronic Datasheet (EDS) JSON documents
- a small JavaScript library that exposes the same bundled schema and validation logic

The package ships with the bundled JSON Schema 2020-12 compound schema, so validation works locally with no network fetches and no separate schema checkout.

## Install

### CLI install
```bash
pnpm add -g @diodeinc/edatasheet
edatasheet version
```

### Library install
```bash
pnpm add @diodeinc/edatasheet
```

## Public API

The supported library API is intentionally tiny:

- `getBundledSchema()`
- `validate(input, options?)`

Anything else should be treated as internal.

### Example
```js
import { getBundledSchema, validate } from "@diodeinc/edatasheet";

const schema = getBundledSchema();

const inMemory = await validate({
  componentID: {
    partType: "microcontroller"
  }
});

const onDisk = await validate("examples/ic_microcontroller/STM32F302R6T6TR.json");

console.log(schema.$id);
console.log(inMemory.valid);
console.log(onDisk.valid);
```

## CLI

### Commands
```bash
edatasheet validate <json-file...>
edatasheet lint <json-file...>
edatasheet schema
edatasheet version
```

### `validate`
Emits deterministic structured JSON reports intended for automation, CI, and model consumption.

```bash
edatasheet validate examples/ic_microcontroller/STM32F302R6T6TR.json
```

For multiple files, the JSON output keeps the aggregate top-level result:

```bash
edatasheet validate examples/a.json examples/b.json
```

### `lint`
Emits a shorter human-readable terminal report.

```bash
edatasheet lint examples/ic_microcontroller/STM32F302R6T6TR.json
```

### `schema`
Prints the embedded bundled schema to stdout or a file.

```bash
edatasheet schema --id
edatasheet schema --pretty
edatasheet schema --output component.compound.schema.json
```

### `version`
Prints package and bundled schema metadata.

```bash
edatasheet version
edatasheet version --json
```

## `validate()` behavior

`validate(input, options?)` accepts:

- an in-memory JavaScript object
- a file path string
- a `file:` URL

It always returns one structured validation report:

```js
{
  file: string,
  valid: boolean,
  summary: {
    error_count: number,
    missing_required: number,
    type_errors: number,
    enum_errors: number,
    unknown_fields: number,
    constraint_errors: number,
    composition_errors: number,
    other_errors: number
  },
  missing_required: string[],
  type_errors: object[],
  enum_errors: object[],
  unknown_fields: object[],
  constraint_errors: object[],
  composition_errors: object[],
  other_errors: object[],
  raw_errors: object[]
}
```

`options` supports:

- `schemaPath`
- `entryId`

## Local Development

```bash
pnpm install
pnpm test
pnpm run build:compound-schema
pnpm run edatasheet -- version
pnpm run edatasheet -- validate examples/ic_microcontroller/STM32F302R6T6TR.json
pnpm pack
```

## Publishing

```bash
pnpm test
pnpm publish --access public
```

The package name is `@diodeinc/edatasheet`, and the installed binary remains `edatasheet`.
