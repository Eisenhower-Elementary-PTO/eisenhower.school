import { describe, expect, it } from "vitest";
import type { PublicCalendarEventDTO } from "@sd/shared";
import { cardTags, eventCard, whenLine } from "./unfurl.js";

const base: PublicCalendarEventDTO = {
  id: "x",
  kind: "managed",
  title: "Fall Carnival",
  location: "Gym",
  description: "Games,   food\nand fun.",
  meetingUrl: "https://meet.example/secret",
  start: "2026-11-22T17:00:00Z", // 11:00 AM Chicago
  end: "2026-11-22T20:00:00Z",
  allDay: false,
  sourceIds: [],
  source: { name: "PTO", color: "#000" },
  volunteerSlug: "abc",
};

describe("event unfurl card", () => {
  it("reads the time in the school's zone", () => {
    expect(whenLine(base, "America/Chicago", "en")).toMatch(/Sun, Nov 22 · 11:00.*2:00\s?PM/);
  });

  it("reads all-day events in UTC with no clock", () => {
    const d = whenLine({ start: "2026-11-22T00:00:00Z", end: null, allDay: true }, "America/Chicago", "en");
    expect(d).toBe("Sun, Nov 22");
  });

  it("leads with when and where, then a flattened description", () => {
    const c = eventCard(base, "America/Chicago");
    expect(c.title).toBe("Fall Carnival");
    expect(c.description).toMatch(/· Gym\nGames, food and fun\.$/);
  });

  it("clips long descriptions", () => {
    const c = eventCard({ ...base, description: "word ".repeat(100) }, "America/Chicago");
    expect(c.description.split("\n")[1]!.length).toBeLessThanOrEqual(160);
    expect(c.description.endsWith("…")).toBe(true);
  });

  it("never carries the meeting url", () => {
    const c = eventCard(base, "America/Chicago");
    expect(JSON.stringify(c)).not.toContain("secret");
  });

  it("escapes admin-typed text in attributes", () => {
    const c = eventCard({ ...base, title: `"><script>alert(1)</script>`, location: `a"b` }, "America/Chicago");
    const tags = cardTags(c, "https://calendar.example/e/1/x", "https://calendar.example/i.png");
    expect(tags).not.toContain("<script>");
    expect(tags).not.toMatch(/content="[^"]*"[^ >\/]/);
    expect(tags).toContain("&lt;script&gt;");
  });
});
