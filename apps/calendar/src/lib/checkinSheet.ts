// The printable volunteer check-in sheet: one row per volunteer, grouped by
// position, with a blank box to tick on arrival and a few empty rows for
// walk-ups. Admin-only (the caller sits behind the sheet's admin screen), so it
// carries NAMES — which is why it is built here in the browser from the
// members-only sheet already loaded, and never served from any URL.
//
// Admin chrome is English-only, like the screen that calls it.
import { formatClockRange, type VolunteerSheetDTO } from "@sd/shared";
import { SCHOOL_TIME_ZONE } from "./timezone.js";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A complete standalone HTML document, print-styled. Every interpolated value
 *  is escaped: titles, positions and names are member-typed. */
export function checkinSheetHtml(sheet: VolunteerSheetDTO): string {
  const when = new Date(sheet.event.start).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: sheet.event.allDay ? "UTC" : SCHOOL_TIME_ZONE,
  });
  const eventTime = sheet.event.allDay
    ? ""
    : formatClockRange(sheet.event.start, sheet.event.end, undefined, SCHOOL_TIME_ZONE);

  const sections = sheet.positions
    .map((p) => {
      const shift =
        p.startsAt && p.endsAt
          ? formatClockRange(p.startsAt, p.endsAt, undefined, SCHOOL_TIME_ZONE)
          : p.startsAt
            ? formatClockRange(p.startsAt, null, undefined, SCHOOL_TIME_ZONE)
            : "";
      const rows = p.signups.map(
        (s) =>
          `<tr><td class="box"><span></span></td><td>${esc(s.displayName)}${
            s.note ? `<div class="note">${esc(s.note)}</div>` : ""
          }</td><td class="arr"></td><td class="sig"></td></tr>`,
      );
      // Open spots print as blank lines to write a walk-up onto.
      const open = Math.max(0, p.slots - p.signups.length);
      for (let i = 0; i < open; i++) {
        rows.push(`<tr class="open"><td class="box"><span></span></td><td></td><td class="arr"></td><td class="sig"></td></tr>`);
      }
      return `<section>
<h2>${esc(p.title)}${shift ? ` <small>${esc(shift)}</small>` : ""}<span class="count">${p.signups.length} of ${p.slots}</span></h2>
${p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
<table><thead><tr><th class="box"></th><th>Name</th><th class="arr">Arrived</th><th class="sig">Initials</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Volunteer check-in — ${esc(sheet.event.title)}</title>
<style>
  @page { margin: 0.6in; }
  * { box-sizing: border-box; }
  body { font: 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: #000; margin: 0; }
  h1 { font-size: 22px; margin: 0; }
  .meta { color: #333; margin: 2px 0 14px; }
  .cols { column-count: 2; column-gap: 0.35in; column-rule: 1px solid #ccc; }
  section { margin-bottom: 14px; break-inside: avoid; }
  h2 { font-size: 14px; flex-wrap: wrap; margin: 0 0 4px; display: flex; gap: 8px; align-items: baseline; border-bottom: 2px solid #000; padding-bottom: 2px; }
  h2 small { font-weight: 400; color: #333; font-size: 13px; }
  .count { margin-left: auto; font-weight: 400; font-size: 12px; }
  .desc { margin: 2px 0 4px; font-size: 12px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; color: #444; padding: 3px 6px; }
  td { border-bottom: 1px solid #999; padding: 4px 5px; height: 30px; vertical-align: middle; }
  .box { width: 28px; } .arr { width: 56px; } .sig { width: 56px; }
  td.box span { display: inline-block; width: 18px; height: 18px; border: 1.5px solid #000; }
  .note { font-size: 11px; color: #444; }
  .foot { margin-top: 10px; font-size: 11px; color: #555; }
</style></head><body>
<h1>${esc(sheet.event.title)}</h1>
<div class="meta">${esc(when)}${eventTime ? ` · ${esc(eventTime)}` : ""}${sheet.event.location ? ` · ${esc(sheet.event.location)}` : ""} — Volunteer check-in</div>
${sections ? `<div class="cols">${sections}</div>` : "<p>No positions on this sheet yet.</p>"}
<div class="foot">Printed ${esc(new Date().toLocaleString())}. Contains volunteer names — please don’t post.</div>
<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 150); });</script>
</body></html>`;
}

/** Opens the sheet in a new tab and prints it. Returns false when the browser
 *  blocked the pop-up, so the caller can say so. */
export function printCheckinSheet(sheet: VolunteerSheetDTO): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(checkinSheetHtml(sheet));
  w.document.close();
  return true;
}
