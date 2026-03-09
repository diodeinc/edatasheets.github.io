import {
    createValidator,
    readBundledSchema,
    validateFiles
} from "./validation.mjs";

export function getBundledSchema() {
    return JSON.parse(readBundledSchema());
}

export async function validateData(data, options = {}) {
    const { validate } = await createValidator(options);
    const valid = validate(data);
    return {
        valid,
        errors: (validate.errors || []).map((error) => ({
            keyword: error.keyword,
            instancePath: error.instancePath,
            schemaPath: error.schemaPath,
            message: error.message,
            params: error.params
        }))
    };
}

export async function validateFile(filePath, options = {}) {
    const result = await validateFiles({
        ...options,
        dataPaths: [filePath]
    });
    return result.results[0];
}
