/** FR-007: static scan item outcomes from the scan-service consumer; not ScriptHealth. */
export const staticScanItemStatusValues = Object.freeze([
  'parsed', 'parse-error', 'unreadable', 'skipped',
] as const);
export type StaticScanItemStatus = (typeof staticScanItemStatusValues)[number];
export function parseStaticScanItemStatus(input: unknown): StaticScanItemStatus {
  if (typeof input !== 'string' || !staticScanItemStatusValues.some(value => value === input)) {
    throw new TypeError('Invalid StaticScanItemStatus');
  }
  return input as StaticScanItemStatus;
}

/** FR-040/NFR-006: current static report JSON wire-schema version. */
export const staticReportSchemaVersion = 2 as const;
export function parseStaticReportSchemaVersion(input: unknown): typeof staticReportSchemaVersion {
  if (input !== staticReportSchemaVersion) {
    throw new TypeError('Unsupported static report schema version');
  }
  return staticReportSchemaVersion;
}

/** FR-040: only the export formats currently supported by the reporting consumer. */
export const reportFormatValues = Object.freeze(['json','markdown'] as const);
export type ReportFormat = (typeof reportFormatValues)[number];
export function parseReportFormat(input: unknown): ReportFormat {
  if (typeof input !== 'string' || !reportFormatValues.some(value => value === input)) {
    throw new TypeError('Invalid ReportFormat');
  }
  return input as ReportFormat;
}

/** FR-029/030: a recoverable script × site-state item, distinct from the batch job. */
export const jobItemStatusValues = Object.freeze([
  'queued', 'preparing', 'running', 'completed', 'failed', 'blocked', 'cancelled',
] as const);
export type JobItemStatus = (typeof jobItemStatusValues)[number];
export function parseJobItemStatus(input: unknown): JobItemStatus {
  if (typeof input !== 'string' || !jobItemStatusValues.some(value => value === input)) {
    throw new TypeError('Invalid JobItemStatus');
  }
  return input as JobItemStatus;
}

/** FR-029: job-level batch queue status vocabulary; not a transition engine. */
export const jobStatusValues = Object.freeze([
  'queued', 'preparing', 'running', 'paused', 'cancelling',
  'cancelled', 'blocked', 'failed', 'completed', 'partially_completed',
] as const);
export type JobStatus = (typeof jobStatusValues)[number];
export function parseJobStatus(input: unknown): JobStatus {
  if (typeof input !== 'string' || !jobStatusValues.some(value => value === input)) {
    throw new TypeError('Invalid JobStatus');
  }
  return input as JobStatus;
}

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
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
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

  const keys = Reflect.ownKeys(input);
  if (Object.hasOwn(input, 'ok') && input.ok === true && keys.length === 2 && keys.includes('value')) {
    return { ok: true, value: parseValue(input.value) };
  }
  if (Object.hasOwn(input, 'ok') && input.ok === false && keys.length === 2 && keys.includes('error')) {
    return { ok: false, error: parseError(input.error) };
  }
  throw new TypeError('Invalid discriminated Result shape');
}

export {
  verificationLevels,
  verificationStatuses,
  parseVerificationChain,
} from './verification-chain.ts';
export type {
  VerificationLevel,
  VerificationStatus,
  VerificationChain,
} from './verification-chain.ts';

export {parseAuditTrace} from './audit-trace.ts';
export type {AuditTrace} from './audit-trace.ts';
