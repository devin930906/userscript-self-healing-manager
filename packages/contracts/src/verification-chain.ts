/** FR-024: a level may pass only after every lower level has passed. */
export const verificationLevels = Object.freeze(['V0', 'V1', 'V2', 'V3', 'V4'] as const);
export const verificationStatuses = Object.freeze(['passed', 'failed', 'skipped', 'blocked', 'not-configured'] as const);
export type VerificationLevel = (typeof verificationLevels)[number];
export type VerificationStatus = (typeof verificationStatuses)[number];
export type VerificationChain = Readonly<Record<VerificationLevel, VerificationStatus>>;

/** Strictly validate untrusted serialized level evidence without executing it. */
export function parseVerificationChain(input: unknown): VerificationChain {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Verification chain must be a plain object');
  }
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
    throw new TypeError('Verification chain must be a plain object');
  }
  const value = input as Record<string, unknown>;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== verificationLevels.length ||
      !verificationLevels.every(level => Object.hasOwn(value,level))) {
    throw new TypeError('Verification chain requires exactly V0 through V4');
  }
  const result = {} as Record<VerificationLevel, VerificationStatus>;
  let priorPassed = true;
  for (const level of verificationLevels) {
    const descriptor = Object.getOwnPropertyDescriptor(value, level);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`Invalid ${level} verification descriptor`);
    }
    const status: unknown = descriptor.value;
    if (typeof status !== 'string' || !verificationStatuses.some(v => v === status)) {
      throw new TypeError(`Invalid ${level} verification status`);
    }
    if (status === 'passed' && !priorPassed) {
      throw new TypeError(`${level} cannot pass without prior levels passing`);
    }
    result[level] = status as VerificationStatus;
    priorPassed = priorPassed && status === 'passed';
  }
  return Object.freeze(result);
}
