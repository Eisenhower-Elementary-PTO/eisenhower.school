// Hostname redirector. This Worker owns hostnames that exist only to send a
// visitor somewhere else, and 301s every request on each of them.
//
// Two kinds of entry live in the map:
//
// - A legacy host, which forwards to a live host PRESERVING the path and
//   query. directory.meandmybadself.com is that case: magic-link emails sent
//   before the move point at /auth/callback?token=… on the old host, and those
//   links must keep working.
//
// - A vanity host, which forwards to one fixed URL and DISCARDS the path — a
//   short name people can say out loud for a link nobody can. ptomeet is that
//   case: the PTO's standing Google Meet room. Nothing on such a host has a
//   path worth keeping, so ptomeet.eisenhower.school/anything lands on the room.
//   It answers 302, not 301: the target is expected to change (a Meet code can
//   be replaced or expire), and browsers cache a 301 indefinitely, so a
//   permanent redirect would keep sending past visitors to the old room.
//
// Add a hostname here AND as a custom_domain route in wrangler.toml; wrangler
// provisions the DNS record and certificate on deploy. Don't reach for a
// Cloudflare redirect rule instead — those run before Workers and are not
// tracked in this repo (see CLAUDE.md, "The front door").
type Target =
  | { kind: "host"; host: string }
  | { kind: "url"; url: string };

const TARGETS: Record<string, Target> = {
  "directory.meandmybadself.com": { kind: "host", host: "directory.eisenhower.school" },
  "ptomeet.eisenhower.school": { kind: "url", url: "https://meet.google.com/foc-ohox-vye" },
};

export function redirectFor(request: Request): Response {
  const url = new URL(request.url);
  const target = TARGETS[url.hostname];
  if (!target) return new Response("Not found", { status: 404 });
  if (target.kind === "url") return Response.redirect(target.url, 302);
  url.hostname = target.host;
  url.protocol = "https:";
  url.port = "";
  return Response.redirect(url.toString(), 301);
}

export default {
  fetch: redirectFor,
};
