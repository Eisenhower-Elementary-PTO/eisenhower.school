// Deleting an authored event takes its volunteer sheets with it.
//
// This is a coupling nothing in either file states. `volunteer_sheet` keys on
// `(managed_event_id, occurrence_start)` — the durable pair, never
// `calendar_event.id` (CLAUDE.md invariants 8 and 13) — so its foreign key is
// `managed_event(id)`, the exact row a delete removes. Take the event without
// the sheets and, depending on whether foreign keys are enforced, you either get
// a constraint failure or something worse and quieter: sheets, positions and
// SIGNUPS that survive in the tables while `sheetRow`'s join to `managed_event`
// makes every one of them invisible to every read. Nobody notices, because the
// symptom of the bad case is nothing at all.
//
// The order is asserted as well as the presence: children first, then the event.
//
// The counts are asserted too, and for a reason with no second chance. They are
// read BEFORE the delete and kept on the audit row, because afterwards there is
// no way to learn how many people had claimed a spot on an event that no longer
// exists — an audit entry naming only the id of a deleted row says almost
// nothing (invariant 5).

import { describe, expect, it } from "vitest";
import {
  deleteManagedCalendar,
  deleteManagedEvent,
  managedCalendarRemovalImpact,
} from "../src/lib/managedCalendar.js";
import type { Env } from "../src/env.js";

interface Capture {
  env: Env;
  /** Statements as they reached D1, in order — batched ones included. */
  sql: string[];
  /** Only the statements that actually ran, so a read can't be mistaken for a write. */
  batched: string[];
}

/** A D1 stand-in that answers the two reads these functions make (the row being
 *  deleted, and the volunteer footprint) and records everything else. */
function captureEnv(
  opts: { event?: boolean; calendar?: boolean; sheets?: number; signups?: number; events?: number; occurrences?: number } = {},
): Capture {
  const { event = true, calendar = true, sheets = 2, signups = 5, events = 3, occurrences = 11 } = opts;
  const sql: string[] = [];
  const batched: string[] = [];
  const env = {
    DB: {
      prepare(text: string) {
        return {
          _text: text,
          bind(..._args: unknown[]) {
            return this;
          },
          async first() {
            sql.push(text);
            if (text.includes("FROM managed_event WHERE id")) {
              return event ? { id: "01EVENT", calendar_id: "01CAL", title: "Fall Carnival" } : null;
            }
            if (text.includes("FROM managed_calendar WHERE id")) {
              return calendar ? { id: "01CAL", name: "PTA Events" } : null;
            }
            if (text.includes("AS signups")) return { sheets, signups };
            if (text.includes("AS occurrences")) return { events, occurrences };
            return null;
          },
        };
      },
      async batch(stmts: { _text: string }[]) {
        for (const s of stmts) {
          sql.push(s._text);
          batched.push(s._text);
        }
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    },
  } as unknown as Env;
  return { env, sql, batched };
}

/** Index of the first statement deleting from `table`, or -1. */
const at = (statements: string[], table: string) =>
  statements.findIndex((s) => s.includes(`DELETE FROM ${table}`));

describe("deleteManagedEvent", () => {
  it("removes the volunteer rows before the event they hang off", async () => {
    const { env, batched } = captureEnv();
    await deleteManagedEvent(env, "01EVENT");

    const signup = at(batched, "volunteer_signup");
    const position = at(batched, "volunteer_position");
    const sheet = at(batched, "volunteer_sheet");
    const event = at(batched, "managed_event");
    for (const i of [signup, position, sheet, event]) expect(i).toBeGreaterThanOrEqual(0);
    // Innermost first, and all of them before the row their foreign key names.
    expect(signup).toBeLessThan(position);
    expect(position).toBeLessThan(sheet);
    expect(sheet).toBeLessThan(event);
  });

  it("removes the album links before the event their foreign key names", async () => {
    // event_album references managed_event (migration 0045); D1 enforces it.
    const { env, batched } = captureEnv();
    await deleteManagedEvent(env, "01EVENT");
    const album = at(batched, "event_album");
    expect(album).toBeGreaterThanOrEqual(0);
    expect(album).toBeLessThan(at(batched, "managed_event"));
  });

  it("finds those sheets through managed_event, never through calendar_event", async () => {
    // A sheet does not reference the derived cache at all, and reaching for it
    // here would silently miss every sheet whose occurrence had been edited away
    // — the `orphaned` case, which is exactly the one that must still be cleaned.
    const { env, batched } = captureEnv();
    await deleteManagedEvent(env, "01EVENT");
    const sheetStatements = batched.filter((s) => s.includes("volunteer_"));
    expect(sheetStatements).toHaveLength(3);
    for (const s of sheetStatements) {
      expect(s).toContain("managed_event_id = ?");
      expect(s).not.toContain("calendar_event");
    }
  });

  it("counts the sheets and signups before deleting them", async () => {
    const { env, sql } = captureEnv({ sheets: 2, signups: 5 });
    const removed = await deleteManagedEvent(env, "01EVENT");
    expect(removed).toMatchObject({
      title: "Fall Carnival",
      calendarId: "01CAL",
      sheets: 2,
      signups: 5,
    });
    // The count has to be read while the rows are still there; run after the
    // batch it would report zero every time, and the audit row would record
    // that a delete took nothing with it.
    expect(sql.findIndex((s) => s.includes("AS signups"))).toBeLessThan(at(sql, "volunteer_signup"));
  });

  it("reports a missing event without deleting anything", async () => {
    const { env, batched } = captureEnv({ event: false });
    expect(await deleteManagedEvent(env, "01GONE")).toBeNull();
    expect(batched).toHaveLength(0);
  });
});

describe("deleteManagedCalendar", () => {
  it("takes the sheets of every event it removes", async () => {
    const { env, batched } = captureEnv();
    const removed = await deleteManagedCalendar(env, "01CAL");
    expect(removed).toMatchObject({ title: "PTA Events", sheets: 2, signups: 5 });

    const sheetStatements = batched.filter((s) => s.includes("volunteer_"));
    expect(sheetStatements).toHaveLength(3);
    // Selected by the calendar's events rather than by a sheet id: a calendar
    // holds many events and each of those may hold many sheets.
    for (const s of sheetStatements) {
      expect(s).toContain("FROM managed_event WHERE calendar_id = ?");
    }
    expect(at(batched, "volunteer_sheet")).toBeLessThan(at(batched, "managed_event"));
    expect(at(batched, "managed_event")).toBeLessThan(at(batched, "managed_calendar"));
  });

  it("reports a missing calendar without deleting anything", async () => {
    const { env, batched } = captureEnv({ calendar: false });
    expect(await deleteManagedCalendar(env, "01GONE")).toBeNull();
    expect(batched).toHaveLength(0);
  });
});

describe("managedCalendarRemovalImpact", () => {
  it("counts without deleting anything", async () => {
    const { env, batched } = captureEnv();
    const impact = await managedCalendarRemovalImpact(env, "01CAL");
    expect(impact).toEqual({
      calendarId: "01CAL",
      name: "PTA Events",
      events: 3,
      occurrences: 11,
      sheets: 2,
      signups: 5,
    });
    // A preview that wrote would be the confirmation doing the thing it exists
    // to ask about.
    expect(batched).toHaveLength(0);
  });

  it("counts the same sheets the delete removes", async () => {
    // The whole point of the step is that the number an admin agrees to is the
    // number that goes. Two spellings of "the sheets on this calendar" — one in
    // the preview, one in the cascade — could drift apart silently, and the
    // symptom would be a confirmation that quietly understated the loss.
    const preview = captureEnv();
    await managedCalendarRemovalImpact(preview.env, "01CAL");
    const deletion = captureEnv();
    await deleteManagedCalendar(deletion.env, "01CAL");

    const counted = preview.sql.find((t) => t.includes("AS signups"));
    const deleted = deletion.batched.find((t) => t.includes("DELETE FROM volunteer_sheet"));
    expect(counted).toBeDefined();
    expect(deleted).toBeDefined();
    const predicate = "managed_event_id IN (SELECT id FROM managed_event WHERE calendar_id = ?)";
    expect(counted).toContain(predicate);
    expect(deleted).toContain(predicate);
  });

  it("reports a missing calendar as nothing to confirm", async () => {
    const { env } = captureEnv({ calendar: false });
    expect(await managedCalendarRemovalImpact(env, "01GONE")).toBeNull();
  });
});
