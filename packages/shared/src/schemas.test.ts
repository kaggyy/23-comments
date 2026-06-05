import { describe, expect, it } from "vitest";
import { reportCreateSchema } from "./schemas";

describe("reportCreateSchema", () => {
  it("accepts a rectangle-only report payload", () => {
    const result = reportCreateSchema.safeParse({
      organizationId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      title: "CTA shifts on hover",
      description: "The CTA shifts on hover.",
      pageUrl: "https://example.com",
      pageTitle: "Example",
      screenshotDataUrl: "data:image/png;base64,abc",
      annotatedScreenshotDataUrl: "data:image/png;base64,abc",
      annotations: [
        {
          id: "rect-1",
          type: "rect",
          x: 10,
          y: 20,
          width: 100,
          height: 80
        }
      ],
      viewport: {
        width: 1440,
        height: 900,
        devicePixelRatio: 2
      },
      userAgent: "Vitest"
    });

    expect(result.success).toBe(true);
  });
});
