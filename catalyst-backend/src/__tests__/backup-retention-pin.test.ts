import { describe, expect, it } from "vitest";
import { selectBackupsToPrune } from "../services/backup-retention";

/** Newest-first fixture; `d` is days before `now`. */
const now = new Date("2026-10-14T00:00:00.000Z");
const at = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

describe("selectBackupsToPrune", () => {
  it("keeps the newest N unpinned backups under a count policy", () => {
    const backups = [
      { id: "a", pinned: false, createdAt: at(1) },
      { id: "b", pinned: false, createdAt: at(2) },
      { id: "c", pinned: false, createdAt: at(3) },
    ];
    const pruned = selectBackupsToPrune(backups, { count: 2, days: 0 }, now);
    expect(pruned.map((b) => b.id)).toEqual(["c"]);
  });

  it("never prunes a pinned backup", () => {
    const backups = [
      { id: "new", pinned: false, createdAt: at(1) },
      { id: "pin", pinned: true, createdAt: at(9) },
      { id: "old", pinned: false, createdAt: at(10) },
    ];
    const pruned = selectBackupsToPrune(backups, { count: 1, days: 0 }, now);
    expect(pruned.map((b) => b.id)).toEqual(["old"]);
  });

  it("does not count pinned backups against the keep-last-N slot", () => {
    // Two unpinned backups with a count of 1: the older unpinned one goes,
    // even though a pinned backup sits between them.
    const backups = [
      { id: "u1", pinned: false, createdAt: at(1) },
      { id: "p1", pinned: true, createdAt: at(2) },
      { id: "u2", pinned: false, createdAt: at(3) },
    ];
    const pruned = selectBackupsToPrune(backups, { count: 1, days: 0 }, now);
    expect(pruned.map((b) => b.id)).toEqual(["u2"]);
  });

  it("exempts pinned backups from the age policy", () => {
    const backups = [
      { id: "fresh", pinned: false, createdAt: at(1) },
      { id: "pin", pinned: true, createdAt: at(40) },
      { id: "stale", pinned: false, createdAt: at(30) },
    ];
    const pruned = selectBackupsToPrune(backups, { count: 0, days: 7 }, now);
    expect(pruned.map((b) => b.id)).toEqual(["stale"]);
  });

  it("prunes nothing when both limits are disabled", () => {
    const backups = [
      { id: "a", pinned: false, createdAt: at(100) },
      { id: "b", pinned: true, createdAt: at(200) },
    ];
    expect(selectBackupsToPrune(backups, { count: 0, days: 0 }, now)).toEqual([]);
  });
});
