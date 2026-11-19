/** Mirrors @office/core hasPermission: "*", "<module>:*", or exact. UI gating only; the API enforces. */
export function hasPermission(granted: Iterable<string>, required: string | undefined): boolean {
  if (!required) return true;
  const set = granted instanceof Set ? (granted as Set<string>) : new Set(granted);
  return set.has("*") || set.has(required) || set.has(`${required.split(":")[0]}:*`);
}
