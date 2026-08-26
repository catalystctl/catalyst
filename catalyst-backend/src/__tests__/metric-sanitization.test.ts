import { describe, it, expect } from "vitest";
import { sanitizeMetric, sanitizeIntMetric, toByteCounterBig } from "../websocket/gateway.js";

/**
 * Health-metric sanitization guarantees:
 *  - one poisoned field must never void a report or throw mid-persist
 *  - container CPU above 100% is preserved up to allocated cores
 *  - byte counters degrade to 0n instead of throwing BigInt(NaN)
 */
describe("health metric sanitization", () => {
  describe("sanitizeMetric", () => {
    it("passes through valid in-range values", () => {
      expect(sanitizeMetric(42.7, 0, 100)).toBe(42.7);
      expect(sanitizeMetric("13.5", 0, 400)).toBeCloseTo(13.5);
    });

    it("clamps out-of-range values", () => {
      expect(sanitizeMetric(150, 0, 100)).toBe(100);
      expect(sanitizeMetric(-5, 0, 100)).toBe(0);
      expect(sanitizeMetric(999, 0, 400)).toBe(400);
    });

    it("degrades non-finite input to fallback instead of NaN", () => {
      expect(sanitizeMetric(Number.NaN, 0, 100)).toBe(0);
      expect(sanitizeMetric(null, 0, 100)).toBe(0);
      expect(sanitizeMetric(undefined, 0, 100)).toBe(0);
      expect(sanitizeMetric("garbage", 0, 100)).toBe(0);
      // Custom fallback (e.g. node.maxMemoryMb for missing totals).
      expect(sanitizeMetric(undefined, 0, Number.MAX_SAFE_INTEGER, 16384)).toBe(16384);
    });

    it("respects Infinity bounds so huge-but-valid MiB counts survive", () => {
      const big = 4 * 1024 * 1024; // 4 TiB in MiB
      expect(sanitizeIntMetric(big, 0, Number.MAX_SAFE_INTEGER)).toBe(big);
    });
  });

  describe("sanitizeIntMetric", () => {
    it("rounds fractional values", () => {
      expect(sanitizeIntMetric(10.6, 0, 1_000_000)).toBe(11);
      expect(sanitizeIntMetric(10.2, 0, 1_000_000)).toBe(10);
    });
  });

  describe("toByteCounterBig", () => {
    it("converts ordinary counters exactly", () => {
      expect(toByteCounterBig(1024)).toBe(1024n);
      expect(toByteCounterBig("2048")).toBe(2048n);
    });

    it("floors fractional bytes rather than throwing", () => {
      expect(toByteCounterBig(12.9)).toBe(12n);
    });

    it("never throws on garbage — returns 0n", () => {
      expect(toByteCounterBig(Number.NaN)).toBe(0n);
      expect(toByteCounterBig(-1)).toBe(0n);
      expect(toByteCounterBig(undefined)).toBe(0n);
      expect(toByteCounterBig({ bad: "object" })).toBe(0n);
    });
  });
});
