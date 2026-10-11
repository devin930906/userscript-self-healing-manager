/** Stable identifiers are opaque strings at the contract boundary. */
export type ScriptId = string;

/** Only source inspection statuses belong to this first milestone. */
export const scriptHealthValues = Object.freeze([
  'unverified',
  'parsed',
  'parse-error',
  'runtime-required',
] as const);

export type ScriptHealth = (typeof scriptHealthValues)[number];

/** The parser is deliberately dependency-free so it can run in offline mode. */
export const scriptHealthSchema = {
  parse(input: unknown): ScriptHealth {
    if (
      typeof input !== 'string' ||
      !scriptHealthValues.some((value) => value === input)
    ) {
      throw new TypeError('Invalid ScriptHealth status');
    }
    return input as ScriptHealth;
  },
};

/** Every call site must handle success and failure explicitly. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

type FieldParser<T> = (input: unknown) => T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the discriminant, exact shape, and payload (with caller-supplied parsers). */
export function parseResult<T, E>(
  input: unknown,
  parseValue: FieldParser<T>,
  parseError: FieldParser<E>,
): Result<T, E> {
  if (!isRecord(input)) {
    throw new TypeError('Result must be an object');
  }

  const keys = Object.keys(input);
  if (input.ok === true && keys.length === 2 && keys.includes('value')) {
    return { ok: true, value: parseValue(input.value) };
  }
  if (input.ok === false && keys.length === 2 && keys.includes('error')) {
    return { ok: false, error: parseError(input.error) };
  }
  throw new TypeError('Invalid discriminated Result shape');
}
