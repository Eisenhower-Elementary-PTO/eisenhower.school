// Event photo albums (migration 0045).
//
// The link is a capability — whoever holds it can open the album, and a
// collaborative one can be added to — so what's pinned here is (1) that only a
// Google Photos https link can be stored, because the value is rendered as an
// anchor on a members page, (2) that a no-op write is a no-op (the route keys
// its audit push on `changed`, and an append-only log must not be paddable),
// and (3) that a NEW album can only name a date the series really produces.

import { describe, expect, it } from "vitest";
import { EventAlbumError, normalizeAlbumUrl, setAlbum } from "../src/lib/eventAlbums.js";
import type { Env } from "../src/env.js";

describe("normalizeAlbumUrl", () => {
  it("accepts Google Photos share links and trims them", () => {
    expect(normalizeAlbumUrl("  https://photos.app.goo.gl/AbC123  ")).toBe("https://photos.app.goo.gl/AbC123");
    expect(normalizeAlbumUrl("https://photos.google.com/share/XYZ?key=k")).toBe(
      "https://photos.google.com/share/XYZ?key=k",
    );
  });

  it("treats empty as no album", () => {
    expect(normalizeAlbumUrl("")).toBeNull();
    expect(normalizeAlbumUrl("   ")).toBeNull();
    expect(normalizeAlbumUrl(null)).toBeNull();
    expect(normalizeAlbumUrl(undefined)).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "http://photos.app.goo.gl/AbC123", // not https
    "https://drive.google.com/drive/folders/abc", // not Photos
    "https://photos.app.goo.gl.evil.example/x", // look-alike host
    "https://evil.example/photos.app.goo.gl",
    "photos.app.goo.gl/AbC123", // no scheme
    "not a url",
  ])("refuses %s", (bad) => {
    expect(() => normalizeAlbumUrl(bad)).toThrow(EventAlbumError);
  });

  it("refuses an over-long link", () => {
    expect(() => normalizeAlbumUrl(`https://photos.app.goo.gl/${"a".repeat(600)}`)).toThrow(EventAlbumError);
  });
});

/** Fake D1 over the three tables setAlbum touches. */
function fakeEnv(opts: { series?: boolean; produces?: string[]; albums?: Record<string, string> }) {
  const { series = true, produces = [], albums = {} } = opts;
  const store = { ...albums };
  const writes: string[] = [];
  const env = {
    DB: {
      prepare(text: string) {
        let args: unknown[] = [];
        return {
          bind(...a: unknown[]) {
            args = a;
            return this;
          },
          async first() {
            if (text.includes("FROM managed_event")) return series ? { id: args[0] } : null;
            if (text.includes("FROM event_album")) {
              const url = store[String(args[1])];
              return url ? { url } : null;
            }
            if (text.includes("FROM calendar_event")) {
              return produces.includes(String(args[1])) ? { ok: 1 } : null;
            }
            return null;
          },
          async run() {
            writes.push(text);
            if (text.startsWith("DELETE")) delete store[String(args[1])];
            else store[String(args[1])] = String(args[2]);
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, store, writes };
}

const D1 = "2026-11-20T23:00:00.000Z";
const URL1 = "https://photos.app.goo.gl/one";
const URL2 = "https://photos.app.goo.gl/two";

describe("setAlbum", () => {
  it("is null for a series that doesn't exist", async () => {
    const { env } = fakeEnv({ series: false });
    expect(await setAlbum(env, "01X", D1, URL1)).toBeNull();
  });

  it("adds an album on a date the series produces", async () => {
    const { env, store } = fakeEnv({ produces: [D1] });
    expect(await setAlbum(env, "01X", D1, URL1)).toEqual({ changed: true, previous: null });
    expect(store[D1]).toBe(URL1);
  });

  it("refuses a NEW album on a date the series doesn't produce", async () => {
    const { env, writes } = fakeEnv({ produces: [] });
    await expect(setAlbum(env, "01X", D1, URL1)).rejects.toThrow(EventAlbumError);
    expect(writes).toHaveLength(0);
  });

  it("re-saving the stored link writes nothing", async () => {
    const { env, writes } = fakeEnv({ albums: { [D1]: URL1 } });
    expect(await setAlbum(env, "01X", D1, URL1)).toEqual({ changed: false, previous: URL1 });
    expect(writes).toHaveLength(0);
  });

  it("replaces and clears an existing album even after the date left the agenda", async () => {
    // The agenda forgets past dates; fixing a link after the event must still work.
    const { env, store } = fakeEnv({ produces: [], albums: { [D1]: URL1 } });
    expect(await setAlbum(env, "01X", D1, URL2)).toEqual({ changed: true, previous: URL1 });
    expect(store[D1]).toBe(URL2);
    expect(await setAlbum(env, "01X", D1, "")).toEqual({ changed: true, previous: URL2 });
    expect(store[D1]).toBeUndefined();
  });

  it("clearing an album that isn't there writes nothing", async () => {
    const { env, writes } = fakeEnv({});
    expect(await setAlbum(env, "01X", D1, null)).toEqual({ changed: false, previous: null });
    expect(writes).toHaveLength(0);
  });

  it("rejects a bad link before touching the table", async () => {
    const { env, writes } = fakeEnv({ produces: [D1] });
    await expect(setAlbum(env, "01X", D1, "https://evil.example/x")).rejects.toThrow(EventAlbumError);
    expect(writes).toHaveLength(0);
  });
});
