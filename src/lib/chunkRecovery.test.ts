import { describe, expect, it, vi } from "vitest";

import { attemptChunkRecovery, isChunkLoadError } from "./chunkRecovery";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
}

describe("chunk recovery", () => {
  it("recognizes stale lazy-import failures without matching ordinary errors", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/old.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Internal server error"))).toBe(false);
  });

  it("reloads once and records a guard timestamp", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const recovered = attemptChunkRecovery(
      new TypeError("Failed to fetch dynamically imported module: /assets/old.js"),
      { storage, location: { reload }, now: 100_000 },
    );

    expect(recovered).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith("bana-smartlink:chunk-reload-at", "100000");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not loop when the refreshed deployment still cannot load", () => {
    const storage = memoryStorage("100000");
    const reload = vi.fn();
    const recovered = attemptChunkRecovery(
      new Error("Loading chunk OperationsCenter failed"),
      { storage, location: { reload }, now: 120_000 },
    );

    expect(recovered).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

