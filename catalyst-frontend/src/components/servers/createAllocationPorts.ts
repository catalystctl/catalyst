/**
 * The first port after the highest one already registered on the node, skipping
 * anything in `taken`. Returns 25565 for an empty pool so a fresh node starts
 * where a game server would; the caller's own selection stays untouched.
 */
export function suggestNextFreePort(allocations: Array<{ port: number }>, taken: number[] = []): number {
  const used = new Set<number>(taken);
  for (const allocation of allocations) {
    if (Number.isFinite(allocation.port)) used.add(allocation.port);
  }
  if (used.size === 0) return 25565;
  let candidate = Math.max(...used) + 1;
  while (used.has(candidate) && candidate < 65535) candidate += 1;
  return Math.min(candidate, 65535);
}
