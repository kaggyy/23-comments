import { describe, expect, it } from "vitest";
import { shortId, statusClass } from "./format";

describe("format helpers", () => {
  it("shortens identifiers for table display", () => {
    expect(shortId("1234567890")).toBe("12345678");
  });

  it("creates stable status class names", () => {
    expect(statusClass("in_progress")).toBe("status status-in-progress");
  });
});
