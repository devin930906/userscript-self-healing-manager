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


  it('rejects inherited discriminants and non-enumerable or symbol own extras', () => {
    const text = (value: unknown): string => {
      if (typeof value !== 'string') throw new TypeError('Expected string');
      return value;
    };
    const inherited = Object.assign(Object.create({ok: true}), {value:'ready', other:'ignored'});
    const hidden = {ok:true,value:'ready'};
    Object.defineProperty(hidden,'extra',{value:'smuggled',enumerable:false});
    const symbol = {ok:false,error:'failed'};
    Object.defineProperty(symbol,Symbol('extra'),{value:1});
    for (const input of [inherited,hidden,symbol]) {
      assert.throws(() => contracts.parseResult(input,text,text),TypeError);
    }
  });
  it('accepts both ordinary and null-prototype own-key Result records', () => {
    const parser = (input: unknown) => String(input);
    assert.deepEqual(contracts.parseResult(Object.assign(Object.create(null),{ok:true,value:'yes'}),parser,parser),{ok:true,value:'yes'});
    assert.deepEqual(contracts.parseResult({ok:false,error:'no'},parser,parser),{ok:false,error:'no'});
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

describe('FR-029 shared batch job status values', () => {
  const expected = ['queued','preparing','running','paused','cancelling','cancelled','blocked','failed','completed','partially_completed'];
  it('accepts exactly the designed job statuses without inventing an outcome', () => {
    assert.deepEqual(contracts.jobStatusValues,expected);
    for (const status of expected) assert.equal(contracts.parseJobStatus(status),status);
    assert.equal(Object.isFrozen(contracts.jobStatusValues),true);
  });
  it('rejects unknown, ambiguous, and legacy aliases', () => {
    for (const value of ['success','done','partial','stopped','',null,undefined,1,{},['queued']])
      assert.throws(()=>contracts.parseJobStatus(value),TypeError);
  });
});
