import { describe, expect, it } from 'vitest';
import { parseUserscriptMetadata } from '../src/index.js';

describe('parseUserscriptMetadata', () => {
  it('reads repeated tags and whitespace while retaining unknown values', () => {
    const value = parseUserscriptMetadata('// ==UserScript==\n// @name Example Name\n// @match https://a.invalid/*\n// @match https://b.invalid/*\n// @grant GM_getValue\n// @grant GM_setValue\n// @run-at document-idle\n// ==/UserScript==');
    expect(value.name).toBe('Example Name');
    expect(value.match).toEqual(['https://a.invalid/*', 'https://b.invalid/*']);
    expect(value.grant).toEqual(['GM_getValue', 'GM_setValue']);
    expect(value.runAt).toBe('document-idle');
    expect(value.diagnostics).toEqual([]);
  });
  it('reports missing core fields without throwing', () => {
    const value = parseUserscriptMetadata('console.log("no metadata block");');
    expect(value.name).toBeNull();
    expect(value.match).toEqual([]);
    expect(value.diagnostics.length).toBeGreaterThan(0);
  });
});
