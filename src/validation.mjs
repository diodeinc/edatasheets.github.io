import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, "..");

export const defaultEntryId = "urn:edatasheets:component-compound-schema";
export const defaultSchemaPath = path.join(packageRoot, "generated", "component.compound.schema.json");

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

export function displayPath(targetPath, cwd = process.cwd()) {
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

export function pointerToFriendlyPath(pointer) {
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

function createEmptyReport(dataFile, cwd = process.cwd()) {
    return {
        file: displayPath(dataFile, cwd),
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

function buildReport(dataFile, data, errors, cwd = process.cwd()) {
    const report = createEmptyReport(dataFile, cwd);
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

export async function loadAjv2020() {
    const module = await import("ajv/dist/2020.js");
    return module.default;
}

export function loadJsonFile(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Could not load ${label} ${displayPath(filePath)}: ${error.message}`);
    }
}

export function readBundledSchema(schemaPath = defaultSchemaPath) {
    return fs.readFileSync(schemaPath, "utf8");
}

export async function createValidator({
    schemaPath = defaultSchemaPath,
    entryId = defaultEntryId
} = {}) {
    const Ajv2020 = await loadAjv2020();
    const schema = loadJsonFile(schemaPath, "schema");

    const ajv = new Ajv2020({
        strict: false,
        allErrors: true,
        verbose: true,
        validateSchema: true
    });

    ajv.addSchema(schema);
    const validate = ajv.getSchema(entryId);
    if (!validate) {
        throw new Error(`Schema entrypoint not found: ${entryId}`);
    }

    return { validate, schema };
}

export async function validateFiles({
    dataPaths,
    schemaPath = defaultSchemaPath,
    entryId = defaultEntryId,
    cwd = process.cwd()
}) {
    const { validate } = await createValidator({ schemaPath, entryId });
    const results = [];
    let hasFailures = false;

    for (const dataPath of dataPaths) {
        let data;
        try {
            data = loadJsonFile(dataPath, "JSON file");
        } catch (error) {
            const report = createEmptyReport(dataPath, cwd);
            report.parse_error = error.message.replace(/^Could not load JSON file [^:]+: /, "");
            results.push(report);
            hasFailures = true;
            continue;
        }

        const valid = validate(data);
        results.push(buildReport(dataPath, data, validate.errors || [], cwd));
        if (!valid) {
            hasFailures = true;
        }
    }

    return {
        valid: !hasFailures,
        results
    };
}

export async function loadPackageMetadata() {
    return loadJsonFile(path.join(packageRoot, "package.json"), "package metadata");
}

export function formatPrettyReport(report) {
    if (report.valid) {
        return `${report.file}: valid`;
    }

    const lines = [`${report.file}: invalid`];

    if (report.parse_error) {
        lines.push(`parse error: ${report.parse_error}`);
        return lines.join("\n");
    }

    const sections = [
        ["missing required", report.missing_required],
        ["type errors", report.type_errors.map((item) => `${item.path}: expected ${item.expected}, got ${item.actual}`)],
        [
            "enum errors",
            report.enum_errors.map((item) => {
                const allowed = item.expected_one_of.join(", ");
                return `${item.path}: expected one of [${allowed}], got ${JSON.stringify(item.actual)}`;
            })
        ],
        [
            "unknown fields",
            report.unknown_fields.map((item) => `${item.path}: unexpected property ${item.property}`)
        ],
        [
            "constraint errors",
            report.constraint_errors.map((item) => `${item.path}: ${item.keyword} (${item.message})`)
        ],
        [
            "composition errors",
            report.composition_errors.map((item) =>
                item.actual_part_type
                    ? `${item.path}: ${item.keyword} failed for partType ${item.actual_part_type}`
                    : `${item.path}: ${item.keyword} (${item.message})`
            )
        ],
        ["other errors", report.other_errors.map((item) => `${item.path}: ${item.keyword} (${item.message})`)]
    ];

    for (const [label, items] of sections) {
        if (!items || items.length === 0) {
            continue;
        }
        lines.push(`${label}:`);
        for (const item of items) {
            lines.push(`  - ${item}`);
        }
    }

    return lines.join("\n");
}
