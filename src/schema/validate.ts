import { loadValidator, type SchemaName } from "./load.js";

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function validate<T = unknown>(name: SchemaName, data: unknown): ValidateResult<T> {
  const v = loadValidator(name);
  if (!v) return { ok: false, errors: [`schema ${name} not found`] };
  if (v(data)) return { ok: true, value: data as T };
  const errors = (v.errors ?? []).map((e) => {
    const where = e.instancePath || "(root)";
    return `${where} ${e.message ?? "is invalid"}`.trim();
  });
  return { ok: false, errors: errors.length ? errors : ["schema validation failed"] };
}
