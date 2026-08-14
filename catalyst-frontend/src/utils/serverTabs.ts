export function canShowServerDatabasesTab({
  hasDatabaseRead,
  databaseAllocation,
  hostCount,
}: {
  hasDatabaseRead: boolean;
  databaseAllocation?: number | null;
  hostCount: number;
}): boolean {
  return hasDatabaseRead && (databaseAllocation ?? 0) > 0 && hostCount > 0;
}
