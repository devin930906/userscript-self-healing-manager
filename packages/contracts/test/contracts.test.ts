import { describe, expect, it } from 'vitest';
import { SCRIPT_HEALTH, resultSchema, scriptHealthSchema } from '../src/index';

describe('ScriptHealth runtime boundary', () => {
  it('accepts precisely the four planned states', () => {
    for (const status of SCRIPT_HEALTH) expect(scriptHealthSchema.safeParse(status)).toEqual({ success: true, data: status });
  });
  it('rejects unknown and incorrectly typed states', () => {
    for (const value of ['healthy', 'passed', 'runtime_required', '', null, 1, {}]) {
      expect(scriptHealthSchema.safeParse(value).success).toBe(false);
    }
  });
});
describe('Result runtime boundary', () => {
  const stringSchema = { safeParse: (x: unknown) => typeof x === 'string' ? { success: true as const, data: x } : { success: false as const, error: { message: 'string required' } } };
  const schema = resultSchema(stringSchema, stringSchema);
  it('accepts both tagged variants', () => {
    expect(schema.safeParse({ ok: true, value: 'ok' }).success).toBe(true);
    expect(schema.safeParse({ ok: false, error: 'failed' }).success).toBe(true);
  });
  it('rejects malformed, mixed, and unknown-key variants', () => {
    for (const value of [{ ok: true, error: 'bad' }, { ok: false, value: 'bad' }, { ok: true, value: 1 }, { ok: true, value: 'x', extra: 1 }, { ok: 'true', value: 'x' }, null]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});
