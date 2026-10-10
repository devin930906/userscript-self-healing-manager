import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/index.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/userscripts/${name}`, import.meta.url)));

describe('analyzeSource', () => {
  it('extracts static calls, source ranges, scope and fallback ||', () => {
    const input = fixture('static.user.js');
    const result = analyzeSource({ scriptId: 'static', sourceBytes: input });
    expect(result.parseDiagnostics).toEqual([]);
    expect(result.selectorRecords.some(record => record.method === 'querySelector' && record.expression === '#primary')).toBe(true);
    expect(result.selectorRecords.some(record => record.method === 'getElementById' && record.expression === 'backup')).toBe(true);
    expect(result.selectorRecords.some(record => record.method === 'closest' && record.expression === '.container')).toBe(true);
    expect(result.selectorRecords.some(record => record.alternateSelectors.includes('backup'))).toBe(true);
    expect(result.selectorRecords.every(record => record.sourceRange.end > record.sourceRange.start)).toBe(true);
    expect(result.selectorRecords.some(record => record.functionName === 'boot')).toBe(true);
  });
  it('analyzeSource_reportsDynamicTemplateWithoutEvaluating', () => {
    const result = analyzeSource({ scriptId: 'dynamic', sourceBytes: fixture('dynamic.user.js') });
    expect(result.selectorRecords.some(record => record.dynamicKind === 'template-dynamic' && record.runtimeRequired)).toBe(true);
    expect(result.selectorRecords.some(record => record.dynamicKind === 'concat-dynamic' && record.runtimeRequired)).toBe(true);
    expect(result.selectorRecords.some(record => record.dynamicKind === 'wrapper-unknown' && record.runtimeRequired)).toBe(true);
  });
  it('analyzeSource_preservesByteHash for UTF-8 BOM and CRLF', () => {
    const bytes = Buffer.from('\uFEFF// ==UserScript==\r\n// @name 字节测试\r\n// ==/UserScript==\r\ndocument.querySelector("#a");\r\n');
    const result = analyzeSource({ scriptId: 'bytes', sourceBytes: bytes });
    expect(result.sourceSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.lineEnding).toBe('crlf');
    expect(result.encoding).toBe('utf-8-bom');
    expect(result.selectorRecords[0]?.expression).toBe('#a');
  });
  it('returns diagnostics for invalid JavaScript rather than throwing', () => {
    const result = analyzeSource({ scriptId: 'invalid', sourceBytes: fixture('invalid.user.js') });
    expect(result.parseDiagnostics.length).toBeGreaterThan(0);
  });
});
