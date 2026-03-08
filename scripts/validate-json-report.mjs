#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const defaultSchemaPath = path.join(cwd, "generated", "component.compound.schema.json");
const defaultEntryId = "urn:edatasheets:component-compound-schema";

const constraintKeywords = new Set([
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
    "contains",
    "minContains",
    "maxContains",
    "minProperties",
    "maxProperties",
    "dependentRequired"
]);

const compositionKeywords = new Set(["oneOf", "anyOf", "allOf", "not", "if", "then", "else"]);

function parseArgs(argv) {
    const args = {
        schemaPath: defaultSchemaPath,
        entryId: defaultEntryId,
        dataPaths: []
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--schema") {
            const value = argv[++i];
            if (!value || value.startsWith("--")) {
                throw new Error("Missing value for --schema");
            }
            args.schemaPath = path.resolve(cwd, value);
        } else if (arg === "--entry-id") {
            const value = argv[++i];
            if (!value || value.startsWith("--")) {
                throw new Error("Missing value for --entry-id");
            }
            args.entryId = value;
        } else if (arg === "--help" || arg === "-h") {
            args.help = true;
        } else {
            args.dataPaths.push(path.resolve(cwd, arg));
        }
    }

    return args;
}

function printHelp() {
    console.log(`Usage:
  node scripts/validate-json-report.mjs [options] <json-file> [more-json-files...]

Options:
  --schema <path>    Path to the compound schema bundle
                     Default: generated/component.compound.schema.json
  --entry-id <id>    Schema id to use as the validation entrypoint
                     Default: urn:edatasheets:component-compound-schema
`);
}

function displayPath(targetPath) {
    const relative = path.relative(cwd, targetPath);
    if (relative === "") {
        return ".";
    }
    return relative.startsWith("..") ? targetPath : relative;
}

function decodePointerToken(token) {
    return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function pointerTokens(pointer) {
    if (!pointer || pointer === "/") {
        return [];
    }
    return pointer
        .split("/")
        .slice(1)
        .map(decodePointerToken);
}

function pointerToFriendlyPath(pointer) {
    const tokens = pointerTokens(pointer);
    if (tokens.length === 0) {
        return "";
    }

    let output = "";
    for (const token of tokens) {
        if (/^\d+$/.test(token)) {
            output += `[${token}]`;
        } else if (output === "") {
            output = token;
        } else {
            output += `.${token}`;
        }
    }
    return output;
}

function appendFriendlyPath(basePointer, token) {
    const base = pointerToFriendlyPath(basePointer);
    if (/^\d+$/.test(token)) {
        return `${base}[${token}]`;
    }
    return base ? `${base}.${token}` : token;
}

function getValueAtPointer(data, pointer) {
    let current = data;
    for (const token of pointerTokens(pointer)) {
        if (current === undefined || current === null) {
            return undefined;
        }
        current = current[token];
    }
    return current;
}

function getActualType(value) {
    if (Array.isArray(value)) {
        return "array";
    }
    if (value === null) {
        return "null";
    }
    return typeof value;
}

function uniqueBySignature(items) {
    const seen = new Set();
    return items.filter((item) => {
        const signature = JSON.stringify(item);
        if (seen.has(signature)) {
            return false;
        }
        seen.add(signature);
        return true;
    });
}

function normalizeRawError(error) {
    return {
        keyword: error.keyword,
        instance_path: pointerToFriendlyPath(error.instancePath),
        schema_path: error.schemaPath,
        message: error.message,
        params: error.params
    };
}

function createEmptyReport(dataFile) {
    return {
        file: displayPath(dataFile),
        valid: false,
        summary: {
            error_count: 0,
            missing_required: 0,
            type_errors: 0,
            enum_errors: 0,
            unknown_fields: 0,
            constraint_errors: 0,
            composition_errors: 0,
            other_errors: 0
        },
        missing_required: [],
        type_errors: [],
        enum_errors: [],
        unknown_fields: [],
        constraint_errors: [],
        composition_errors: [],
        consistency_checks: [],
        other_errors: [],
        raw_errors: []
    };
}

function buildReport(dataFile, data, errors) {
    const report = createEmptyReport(dataFile);
    report.valid = errors.length === 0;
    report.raw_errors = errors.map(normalizeRawError);

    const compositePaths = new Set(
        errors.filter((error) => compositionKeywords.has(error.keyword)).map((error) => error.instancePath)
    );

    const isCompositeNoise = (error) => {
        if (!["required", "additionalProperties", "enum", "const"].includes(error.keyword)) {
            return false;
        }

        for (const compositePath of compositePaths) {
            if (compositePath === "") {
                if (error.instancePath !== "") {
                    return true;
                }
                continue;
            }
            if (error.instancePath === compositePath || error.instancePath.startsWith(`${compositePath}/`)) {
                return true;
            }
        }
        return false;
    };

    for (const error of errors) {
        if (isCompositeNoise(error)) {
            continue;
        }

        if (error.keyword === "required") {
            report.missing_required.push(appendFriendlyPath(error.instancePath, error.params.missingProperty));
            continue;
        }

        if (error.keyword === "type") {
            report.type_errors.push({
                path: pointerToFriendlyPath(error.instancePath),
                expected: error.params.type,
                actual: getActualType(getValueAtPointer(data, error.instancePath)),
                message: error.message
            });
            continue;
        }

        if (error.keyword === "enum") {
            report.enum_errors.push({
                path: pointerToFriendlyPath(error.instancePath),
                expected_one_of: error.params.allowedValues,
                actual: getValueAtPointer(data, error.instancePath),
                message: error.message
            });
            continue;
        }

        if (error.keyword === "const") {
            report.enum_errors.push({
                path: pointerToFriendlyPath(error.instancePath),
                expected_one_of: [error.params.allowedValue],
                actual: getValueAtPointer(data, error.instancePath),
                message: error.message
            });
            continue;
        }

        if (error.keyword === "additionalProperties") {
            const property = error.params.additionalProperty;
            report.unknown_fields.push({
                path: appendFriendlyPath(error.instancePath, property),
                property,
                message: error.message
            });
            continue;
        }

        if (constraintKeywords.has(error.keyword)) {
            report.constraint_errors.push({
                path: pointerToFriendlyPath(error.instancePath),
                keyword: error.keyword,
                params: error.params,
                actual: getValueAtPointer(data, error.instancePath),
                message: error.message
            });
            continue;
        }

        if (compositionKeywords.has(error.keyword)) {
            const compositeValue = getValueAtPointer(data, error.instancePath);
            const item = {
                path: pointerToFriendlyPath(error.instancePath),
                keyword: error.keyword,
                message: error.message,
                params: error.params
            };
            if (
                compositeValue &&
                typeof compositeValue === "object" &&
                !Array.isArray(compositeValue) &&
                typeof compositeValue.partType === "string"
            ) {
                item.actual_part_type = compositeValue.partType;
            }
            report.composition_errors.push(item);
            continue;
        }

        report.other_errors.push({
            path: pointerToFriendlyPath(error.instancePath),
            keyword: error.keyword,
            params: error.params,
            actual: getValueAtPointer(data, error.instancePath),
            message: error.message
        });
    }

    report.missing_required = [...new Set(report.missing_required)];
    report.type_errors = uniqueBySignature(report.type_errors);
    report.enum_errors = uniqueBySignature(report.enum_errors);
    report.unknown_fields = uniqueBySignature(report.unknown_fields);
    report.constraint_errors = uniqueBySignature(report.constraint_errors);
    report.composition_errors = uniqueBySignature(report.composition_errors);
    report.other_errors = uniqueBySignature(report.other_errors);

    report.summary = {
        error_count: report.raw_errors.length,
        missing_required: report.missing_required.length,
        type_errors: report.type_errors.length,
        enum_errors: report.enum_errors.length,
        unknown_fields: report.unknown_fields.length,
        constraint_errors: report.constraint_errors.length,
        composition_errors: report.composition_errors.length,
        other_errors: report.other_errors.length
    };

    return report;
}

async function loadAjv2020() {
    try {
        const module = await import("ajv/dist/2020.js");
        return module.default;
    } catch {
        console.error("Could not load ajv. Run `npm install` in the repo root first.");
        process.exit(1);
    }
}

function loadJsonFile(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Could not load ${label} ${displayPath(filePath)}: ${error.message}`);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || args.dataPaths.length === 0) {
        printHelp();
        process.exit(args.help ? 0 : 1);
    }

    const Ajv2020 = await loadAjv2020();
    const schema = loadJsonFile(args.schemaPath, "schema");

    const ajv = new Ajv2020({
        strict: false,
        allErrors: true,
        verbose: true,
        validateSchema: true
    });

    ajv.addSchema(schema);
    const validate = ajv.getSchema(args.entryId);
    if (!validate) {
        throw new Error(`Schema entrypoint not found: ${args.entryId}`);
    }

    const results = [];
    let hasFailures = false;

    for (const dataPath of args.dataPaths) {
        let data;
        try {
            data = loadJsonFile(dataPath, "JSON file");
        } catch (error) {
            const report = createEmptyReport(dataPath);
            report.parse_error = error.message.replace(/^Could not load JSON file [^:]+: /, "");
            results.push(report);
            hasFailures = true;
            continue;
        }

        const valid = validate(data);
        results.push(buildReport(dataPath, data, validate.errors || []));
        if (!valid) {
            hasFailures = true;
        }
    }

    console.log(JSON.stringify(results.length === 1 ? results[0] : { results }, null, 2));
    process.exit(hasFailures ? 1 : 0);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
