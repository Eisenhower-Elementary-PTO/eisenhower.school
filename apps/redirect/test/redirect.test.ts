import { describe, expect, it } from "vitest";
import { redirectFor } from "../src/index.js";

describe("hostname redirector", () => {
  it("forwards the retired directory host, keeping path and query", () => {
    const res = redirectFor(
      new Request("http://directory.meandmybadself.com/auth/callback?token=abc"),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      "https://directory.eisenhower.school/auth/callback?token=abc",
    );
  });

  it("sends ptomeet to the Meet room whatever the path, temporarily", () => {
    for (const path of ["/", "/anything?x=1"]) {
      const res = redirectFor(new Request(`https://ptomeet.eisenhower.school${path}`));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://meet.google.com/foc-ohox-vye");
    }
  });

  it("sends drive to the shared Drive folder, account-neutral, temporarily", () => {
    for (const path of ["/", "/anything?x=1"]) {
      const res = redirectFor(new Request(`https://drive.eisenhower.school${path}`));
      expect(res.status).toBe(302);
      const location = res.headers.get("location");
      expect(location).toBe("https://drive.google.com/drive/folders/0AGwIfsptxtdbUk9PVA");
      expect(location).not.toMatch(/\/u\/\d/);
    }
  });

  it("404s a host it does not own", () => {
    expect(redirectFor(new Request("https://example.com/")).status).toBe(404);
  });
});
