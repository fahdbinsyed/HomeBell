import type { ErrorCode, Problem } from './generated/schemas';

/** Narrowing helper: is this unknown value a HomeBell problem+json body? */
export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === 'string' && typeof v.status === 'number' && typeof v.title === 'string';
}

/** True if the problem carries the given machine-readable code. */
export function hasErrorCode<C extends ErrorCode>(
  value: unknown,
  code: C,
): value is Problem & { code: C } {
  return isProblem(value) && value.code === code;
}
