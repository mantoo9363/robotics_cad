import { describe, it, expect, vi } from "vitest";
import { LruCache } from "@/lib/lruCache";

describe("LruCache", () => {
  it("stores and retrieves values", () => {
    const c = new LruCache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBe(2);
    expect(c.get("missing")).toBeUndefined();
    expect(c.size).toBe(2);
  });

  it("evicts the least-recently-used entry once max is exceeded", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // evicts "a"
    expect(c.has("a")).toBe(false);
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("get() promotes a key so it survives the next eviction", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // "a" is now most-recently-used
    c.set("c", 3); // evicts "b", not "a"
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
  });

  it("re-setting an existing key refreshes its recency without growing size", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 10); // refresh "a"
    c.set("c", 3); // evicts "b"
    expect(c.get("a")).toBe(10);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
    expect(c.size).toBe(2);
  });

  it("calls onEvict for dropped values only", () => {
    const onEvict = vi.fn();
    const c = new LruCache<string, number>(1, onEvict);
    c.set("a", 1);
    c.set("b", 2); // evicts "a"
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith(1, "a");
  });

  it("clear() runs onEvict for every entry and empties the cache", () => {
    const onEvict = vi.fn();
    const c = new LruCache<string, number>(4, onEvict);
    c.set("a", 1);
    c.set("b", 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(onEvict).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-positive or non-integer max", () => {
    expect(() => new LruCache(0)).toThrow();
    expect(() => new LruCache(-1)).toThrow();
    expect(() => new LruCache(1.5)).toThrow();
  });
});
