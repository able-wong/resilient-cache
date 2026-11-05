/**
 * Run an optional isValid validator against a cached value.
 * Shared by ResilientCacheClient and MockCacheClient so both treat
 * validation the same way.
 *
 * A validator that throws counts as "not valid": a cache read must
 * degrade to a miss, never fail the caller.
 *
 * @returns true if there is no validator or the value passes it
 */
export async function passesValidator<T>(
  value: T,
  isValid: ((value: T) => boolean | Promise<boolean>) | undefined,
): Promise<boolean> {
  if (!isValid) {
    return true;
  }
  try {
    return Boolean(await isValid(value));
  } catch {
    return false;
  }
}
