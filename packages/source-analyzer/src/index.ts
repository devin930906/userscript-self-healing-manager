import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { parseUserscriptMetadata } from './metadata.js';
import { extractSelectorInventory } from './selector-inventory.js';
import type { MetadataParseResult } from './metadata.js';
import type { SelectorRecord } from './selector-inventory.js';

export { parseUserscriptMetadata } from './metadata.js';
export { extractSelectorInventory } from './selector-inventory.js';
export type { MetadataParseResult } from './metadata.js';
export type { SelectorRecord, SourceRange, DynamicKind } from './selector-inventory.js';

export interface SourceAnalysis {
  scriptId: string;
  sourceSha256: string;
  metadata: MetadataParseResult;
  selectorRecords: SelectorRecord[];
  parseDiagnostics: string[];
  encoding: 'utf-8' | 'utf-8-bom' | 'invalid-utf-8';
  lineEnding: 'crlf' | 'lf' | 'cr' | 'none' | 'mixed';
}

function detectLineEnding(text: string): SourceAnalysis['lineEnding'] {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  const types = [crlf, lf, cr].filter(n => n > 0).length;
  if (types > 1) return 'mixed';
  return crlf ? 'crlf' : lf ? 'lf' : cr ? 'cr' : 'none';
}
export function analyzeSource(input: { scriptId: string; sourceBytes: Uint8Array }): SourceAnalysis {
  const bytes = input.sourceBytes;
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let source = '';
  let valid = true;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { valid = false; source = new TextDecoder('utf-8').decode(bytes); }
  const metadata = parseUserscriptMetadata(source);
  const inventory = valid ? extractSelectorInventory(source) : { selectorRecords: [], parseDiagnostics: ['invalid-utf-8'] };
  return {
    scriptId: input.scriptId, sourceSha256, metadata,
    selectorRecords: inventory.selectorRecords,
    parseDiagnostics: inventory.parseDiagnostics,
    encoding: !valid ? 'invalid-utf-8' : bom ? 'utf-8-bom' : 'utf-8',
    lineEnding: detectLineEnding(source)
  };
}
