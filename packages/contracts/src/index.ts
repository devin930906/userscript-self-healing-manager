/** Shared Phase 1 primitives; runtime validation never executes imported userscripts. */
export type ScriptId = string;
export const SCRIPT_HEALTH = ['unverified', 'parsed', 'parse-error', 'runtime-required'] as const;
export type ScriptHealth = (typeof SCRIPT_HEALTH)[number];
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export type ParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly message: string } };

export const scriptHealthSchema = {
  safeParse(input: unknown): ParseResult<ScriptHealth> {
    if (typeof input === 'string' && (SCRIPT_HEALTH as readonly string[]).includes(input)) {
      return { success: true, data: input as ScriptHealth };
    }
    return { success: false, error: { message: 'Invalid ScriptHealth status' } };
  },
  parse(input: unknown): ScriptHealth {
    const result = this.safeParse(input);
    if (!result.success) throw new Error(result.error.message);
    return result.data;
  },
};

export function resultSchema<T, E>(
  valueSchema: { safeParse(input: unknown): ParseResult<T> },
  errorSchema: { safeParse(input: unknown): ParseResult<E> },
) {
  return {
    safeParse(input: unknown): ParseResult<Result<T, E>> {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { success: false, error: { message: 'Result must be an object' } };
      }
      const record = input as Record<string, unknown>;
      const expected = record.ok === true ? ['ok', 'value'] : record.ok === false ? ['ok', 'error'] : null;
      if (expected === null || Object.keys(record).some(key => !expected.includes(key)) || Object.keys(record).length !== 2) {
        return { success: false, error: { message: 'Invalid Result discriminant or shape' } };
      }
      if (record.ok === true) {
        const value = valueSchema.safeParse(record.value);
        return value.success ? { success: true, data: { ok: true, value: value.data } } : { success: false, error: value.error };
      }
      const error = errorSchema.safeParse(record.error);
      return error.success ? { success: true, data: { ok: false, error: error.data } } : { success: false, error: error.error };
    },
  };
}
