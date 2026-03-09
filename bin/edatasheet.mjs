#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
    defaultEntryId,
    defaultSchemaPath,
    displayPath,
    formatPrettyReport,
    loadPackageMetadata,
    readBundledSchema,
    validateFiles
} from "../src/validation.mjs";

function parseGlobalOptions(args) {
    const options = {
        schemaPath: defaultSchemaPath,
        entryId: defaultEntryId
    };
    const positionals = [];

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === "--schema") {
            const value = args[++i];
            if (!value || value.startsWith("--")) {
                throw new Error("Missing value for --schema");
            }
            options.schemaPath = path.resolve(process.cwd(), value);
        } else if (arg === "--entry-id") {
            const value = args[++i];
            if (!value || value.startsWith("--")) {
                throw new Error("Missing value for --entry-id");
            }
            options.entryId = value;
        } else {
            positionals.push(arg);
        }
    }

    return { options, positionals };
}

function printHelp() {
    console.log(`Usage:
  edatasheet <command> [options]

Commands:
  validate <json-file...>   Validate JSON and emit structured JSON reports
  lint <json-file...>       Validate JSON and emit compact human-readable output
  schema                    Print the embedded compound schema
  version                   Print CLI and bundled schema version information
  help                      Show this help text

Global options for validate/lint:
  --schema <path>           Override the bundled compound schema
  --entry-id <id>           Override the schema entrypoint

Schema command options:
  --output <path>           Write schema to a file instead of stdout
  --pretty                  Pretty-print the schema JSON
  --id                      Print only the bundled schema id

Version command options:
  --json                    Print structured JSON
`);
}

async function runValidate(argv) {
    const { options, positionals } = parseGlobalOptions(argv);
    if (positionals.length === 0) {
        throw new Error("validate requires at least one JSON file");
    }

    const dataPaths = positionals.map((item) => path.resolve(process.cwd(), item));
    const result = await validateFiles({
        dataPaths,
        schemaPath: options.schemaPath,
        entryId: options.entryId
    });

    console.log(JSON.stringify(result.results.length === 1 ? result.results[0] : { results: result.results }, null, 2));
    process.exit(result.valid ? 0 : 1);
}

async function runLint(argv) {
    const { options, positionals } = parseGlobalOptions(argv);
    if (positionals.length === 0) {
        throw new Error("lint requires at least one JSON file");
    }

    const dataPaths = positionals.map((item) => path.resolve(process.cwd(), item));
    const result = await validateFiles({
        dataPaths,
        schemaPath: options.schemaPath,
        entryId: options.entryId
    });

    for (const report of result.results) {
        console.log(formatPrettyReport(report));
    }

    process.exit(result.valid ? 0 : 1);
}

async function runSchema(argv) {
    let outputPath = null;
    let printIdOnly = false;
    let pretty = false;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--output") {
            const value = argv[++i];
            if (!value || value.startsWith("--")) {
                throw new Error("Missing value for --output");
            }
            outputPath = path.resolve(process.cwd(), value);
        } else if (arg === "--id") {
            printIdOnly = true;
        } else if (arg === "--pretty") {
            pretty = true;
        } else {
            throw new Error(`Unknown schema option: ${arg}`);
        }
    }

    const raw = readBundledSchema();
    const schema = JSON.parse(raw);
    const output = printIdOnly ? `${schema.$id}\n` : `${JSON.stringify(schema, null, pretty ? 2 : 0)}\n`;

    if (outputPath) {
        fs.writeFileSync(outputPath, output);
        console.error(`Wrote schema to ${displayPath(outputPath)}`);
        return;
    }

    process.stdout.write(output);
}

async function runVersion(argv) {
    const asJson = argv.includes("--json");
    if (argv.some((arg) => arg !== "--json")) {
        throw new Error("Unknown version option");
    }

    const pkg = await loadPackageMetadata();
    const schema = JSON.parse(readBundledSchema());
    const payload = {
        cli_name: "edatasheet",
        package_name: pkg.name,
        package_version: pkg.version,
        schema_id: schema.$id,
        schema_dialect: schema.$schema,
        schema_entry_ref: schema.$ref
    };

    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    console.log(`edatasheet ${payload.package_version}`);
    console.log(`package: ${payload.package_name}`);
    console.log(`schema id: ${payload.schema_id}`);
    console.log(`schema dialect: ${payload.schema_dialect}`);
    console.log(`schema entry ref: ${payload.schema_entry_ref}`);
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);

    if (!command || command === "help" || command === "--help" || command === "-h") {
        printHelp();
        return;
    }

    if (command === "validate") {
        await runValidate(rest);
        return;
    }

    if (command === "lint") {
        await runLint(rest);
        return;
    }

    if (command === "schema") {
        await runSchema(rest);
        return;
    }

    if (command === "version") {
        await runVersion(rest);
        return;
    }

    throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
