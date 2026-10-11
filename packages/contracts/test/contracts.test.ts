import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as contracts from '../src/index.ts';

describe('ScriptHealth runtime contract', () => {
  it('accepts exactly the known health statuses', () => {
    assert.deepEqual(contracts.scriptHealthValues, [
      'unverified',
      'parsed',
      'parse-error',
      'runtime-required',
    ]);

    for (const status of contracts.scriptHealthValues) {
      assert.equal(contracts.scriptHealthSchema.parse(status), status);
    }
  });

  it('rejects unknown, empty and non-string statuses', () => {
    for (const input of ['healthy', 'completed', '', undefined, null, 1, {}, []]) {
      assert.throws(() => contracts.scriptHealthSchema.parse(input), TypeError);
    }
  });
});

describe('Result<T, E> runtime contract', () => {
  const asNonemptyString = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError('Expected a non-empty string');
    }
    return value;
  };

  it('accepts success and failure variants', () => {
    assert.deepEqual(
      contracts.parseResult({ ok: true, value: 'ready' }, asNonemptyString, asNonemptyString),
      { ok: true, value: 'ready' },
    );
    assert.deepEqual(
      contracts.parseResult({ ok: false, error: 'missing' }, asNonemptyString, asNonemptyString),
      { ok: false, error: 'missing' },
    );
  });

  it('rejects malformed, ambiguous and extraneous variants', () => {
    const badValues: unknown[] = [
      null, 3, [], { ok: 'yes', value: 'a' }, { ok: true },
      { ok: false }, { ok: true, error: 'oops' },
      { ok: false, value: 'oops' },
      { ok: true, value: 'a', error: 'oops' },
      { ok: true, value: 'a', extra: 1 },
    ];
    for (const bad of badValues) {
      assert.throws(
        () => contracts.parseResult(bad, asNonemptyString, asNonemptyString),
        TypeError,
      );
    }
  });

  it('validates the discriminated payload using the supplied parser', () => {
    assert.throws(
      () => contracts.parseResult({ ok: true, value: 42 }, asNonemptyString, asNonemptyString),
      /non-empty string/,
    );
    assert.throws(
      () => contracts.parseResult({ ok: false, error: '' }, asNonemptyString, asNonemptyString),
      /non-empty string/,
    );
  });
});
