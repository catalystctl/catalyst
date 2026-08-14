import { describe, it, expect } from 'vitest';
import { canShowServerDatabasesTab } from '../utils/serverTabs';

describe('canShowServerDatabasesTab', () => {
  it('hides when the user cannot read databases', () => {
    expect(
      canShowServerDatabasesTab({
        hasDatabaseRead: false,
        databaseAllocation: 2,
        hostCount: 1,
      }),
    ).toBe(false);
  });

  it('hides when the server has no database allocation', () => {
    expect(
      canShowServerDatabasesTab({
        hasDatabaseRead: true,
        databaseAllocation: 0,
        hostCount: 1,
      }),
    ).toBe(false);
  });

  it('hides when allocation is missing', () => {
    expect(
      canShowServerDatabasesTab({
        hasDatabaseRead: true,
        databaseAllocation: undefined,
        hostCount: 1,
      }),
    ).toBe(false);
  });

  it('hides when the panel has no database hosts', () => {
    expect(
      canShowServerDatabasesTab({
        hasDatabaseRead: true,
        databaseAllocation: 2,
        hostCount: 0,
      }),
    ).toBe(false);
  });

  it('shows when hosts exist and the server has allocation', () => {
    expect(
      canShowServerDatabasesTab({
        hasDatabaseRead: true,
        databaseAllocation: 1,
        hostCount: 1,
      }),
    ).toBe(true);
  });
});
