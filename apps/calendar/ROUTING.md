# Routing: which paths are Functions and which are the bundle

**Pages Function:** `/e/:date/:slug` only. It returns the bundle's own
`index.html` (via `context.next()`) with the event's title, when/where and
description written into the head, for link unfurls in Slack, iMessage and SMS.
The SPA then boots normally. Every failure serves the untouched bundle.

**Everything else** falls through to the bundle's `index.html`.

The Function reads one anonymous route, `/calendar-public/events/:date/:slug`
(invariant 12), so the card holds nothing the open page doesn't. It deliberately
omits `meetingUrl` and volunteer counts. The page stays `noindex`.

## Do not add `public/_redirects`

Pages 308s `/index.html` → `/`, so an SPA-fallback rewrite would break routing.
See `apps/newsletter/ROUTING.md`.
