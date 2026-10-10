import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { Node, Expression, CallExpression, OptionalCallExpression } from '@babel/types';
import type { NodePath } from '@babel/traverse';

export type DynamicKind = 'literal' | 'template-dynamic' | 'concat-dynamic' | 'wrapper-unknown';
export interface SourceRange { start: number; end: number; startLine: number; startColumn: number; endLine: number; endColumn: number }
export interface SelectorRecord {
  method: string;
  expression: string;
  sourceRange: SourceRange;
  functionName: string | null;
  scope: string;
  alternateSelectors: string[];
  dynamicKind: DynamicKind;
  runtimeRequired: boolean;
}
export interface SelectorInventoryResult { selectorRecords: SelectorRecord[]; parseDiagnostics: string[] }

const METHODS = new Set(['querySelector','querySelectorAll','getElementById','getElementsByClassName','getElementsByTagName','getElementsByName','closest','matches']);
type CallNode = CallExpression | OptionalCallExpression;
function methodOf(node: CallNode): string | null {
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return null;
  if (callee.computed) return null;
  return callee.property.type === 'Identifier' && METHODS.has(callee.property.name) ? callee.property.name : null;
}
function literal(node: Node | undefined, source: string): { expression: string; kind: DynamicKind } {
  if (!node) return { expression: '', kind: 'wrapper-unknown' };
  if (node.type === 'StringLiteral') return { expression: node.value, kind: 'literal' };
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length === 0) return { expression: node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? '', kind: 'literal' };
    return { expression: source.slice(node.start ?? 0, node.end ?? 0), kind: 'template-dynamic' };
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') return { expression: source.slice(node.start ?? 0, node.end ?? 0), kind: 'concat-dynamic' };
  return { expression: source.slice(node.start ?? 0, node.end ?? 0), kind: 'wrapper-unknown' };
}
function getFunctionName(path: NodePath<CallNode>): string | null {
  const fn = path.getFunctionParent();
  if (!fn) return null;
  const node = fn.node;
  if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') && node.id) return node.id.name;
  const parent = fn.parentPath?.node;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if (parent?.type === 'ObjectProperty' && parent.key.type === 'Identifier') return parent.key.name;
  return node.type === 'ArrowFunctionExpression' ? '<anonymous-arrow>' : '<anonymous>';
}
function collect(path: NodePath<CallNode>, source: string): SelectorRecord | null {
  const method = methodOf(path.node);
  if (!method) return null;
  const first = path.node.arguments[0];
  const value = literal(first?.type === 'SpreadElement' || first?.type === 'ArgumentPlaceholder' ? undefined : first as Expression | undefined, source);
  const node = path.node;
  const loc = node.loc;
  const fallback = path.findParent(parent => parent.isLogicalExpression() && ['||', '??'].includes(parent.node.operator));
  const alternates: string[] = [];
  if (fallback && fallback.isLogicalExpression()) {
    const branches: Node[] = [];
    const flatten = (n: Node): void => {
      if (n.type === 'LogicalExpression' && (n.operator === '||' || n.operator === '??')) { flatten(n.left); flatten(n.right); }
      else branches.push(n);
    };
    flatten(fallback.node);
    for (const branch of branches) {
      if (branch === node) continue;
      if (branch.type !== 'CallExpression' && branch.type !== 'OptionalCallExpression') continue;
      if (!methodOf(branch)) continue;
      const arg = branch.arguments[0];
      const candidate = literal(arg?.type === 'SpreadElement' || arg?.type === 'ArgumentPlaceholder' ? undefined : arg as Expression | undefined, source);
      if (candidate.kind === 'literal' && candidate.expression !== value.expression && !alternates.includes(candidate.expression)) alternates.push(candidate.expression);
    }
  }
  const scopeUid = path.scope.uid;
  return {
    method, expression: value.expression,
    sourceRange: {
      start: node.start ?? 0, end: node.end ?? 0,
      startLine: loc?.start.line ?? 0, startColumn: loc?.start.column ?? 0,
      endLine: loc?.end.line ?? 0, endColumn: loc?.end.column ?? 0
    },
    functionName: getFunctionName(path), scope: `scope:${scopeUid}`,
    alternateSelectors: alternates,
    dynamicKind: value.kind, runtimeRequired: value.kind !== 'literal'
  };
}
export function extractSelectorInventory(source: string): SelectorInventoryResult {
  const selectorRecords: SelectorRecord[] = [];
  const parseDiagnostics: string[] = [];
  try {
    const ast = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'], errorRecovery: false });
    const visit = (path: NodePath<CallNode>): void => {
      const record = collect(path, source);
      if (record) selectorRecords.push(record);
    };
    traverse(ast, { CallExpression: visit, OptionalCallExpression: visit });
  } catch (error) {
    parseDiagnostics.push(error instanceof Error ? `syntax-error: ${error.message}` : 'syntax-error: unknown');
  }
  return { selectorRecords, parseDiagnostics };
}
