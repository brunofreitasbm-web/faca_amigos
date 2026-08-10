import { describe, it, expect, vi } from "vitest";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts.js";

describe("useKeyboardShortcuts", () => {
  it("exporta o hook useKeyboardShortcuts", () => {
    expect(typeof useKeyboardShortcuts).toBe("function");
  });
});
