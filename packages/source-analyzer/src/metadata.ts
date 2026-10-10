export interface MetadataParseResult {
  name: string | null;
  match: string[];
  grant: string[];
  runAt: string | null;
  include: string[];
  exclude: string[];
  require: string[];
  version: string | null;
  tags: Record<string, string[]>;
  diagnostics: string[];
}

export function parseUserscriptMetadata(source: string): MetadataParseResult {
  const tags: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  const diagnostics: string[] = [];
  const normalized = source.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r\n|\n|\r/);
  const start = lines.findIndex(line => /^\s*\/\/\s*==UserScript==\s*$/.test(line));
  const end = start < 0 ? -1 : lines.findIndex((line, index) => index > start && /^\s*\/\/\s*==\/UserScript==\s*$/.test(line));
  if (start < 0 || end < 0) diagnostics.push('missing-or-unclosed-userscript-header');
  if (start >= 0 && end >= 0) {
    for (const line of lines.slice(start + 1, end)) {
      const match = /^\s*\/\/\s*@([\w-]+)(?:\s+(.*?))?\s*$/.exec(line);
      if (!match) continue;
      (tags[match[1]] ??= []).push((match[2] ?? '').trim());
    }
  }
  const first = (key: string): string | null => tags[key]?.[0] ?? null;
  for (const required of ['name', 'match', 'grant', 'run-at']) {
    if (!tags[required]?.length) diagnostics.push(`missing-@${required}`);
  }
  if ((tags['name']?.length ?? 0) > 1 || (tags['run-at']?.length ?? 0) > 1) diagnostics.push('duplicate-single-value-tag');
  return {
    name: first('name'), match: tags['match'] ?? [], grant: tags['grant'] ?? [],
    runAt: first('run-at'), include: tags['include'] ?? [],
    exclude: tags['exclude'] ?? [], require: tags['require'] ?? [],
    version: first('version'), tags, diagnostics
  };
}
