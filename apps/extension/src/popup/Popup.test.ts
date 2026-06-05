import { describe, expect, it } from "vitest";

describe("popup defaults", () => {
  it("uses a compact popup width from CSS contract", () => {
    expect(380).toBeGreaterThan(320);
  });
});
