// GET /board-agenda — redirect to the board's agenda, a Google Doc.
//
// A Function rather than a `_redirects` line (see ROUTING.md: never add that
// file). 302, not 301: the Doc is the thing most likely to be swapped for
// next year's, and a cached permanent redirect would outlive the swap. Not in
// the sitemap — it is a shortcut for a flyer or a text, not a page.

const AGENDA_URL =
  "https://docs.google.com/document/d/14rKdDpQOFkxmwb1aIJGBKaSD2kkpwhwryVYNDVWnnFY/edit?tab=t.0";

export const onRequestGet: PagesFunction = () => Response.redirect(AGENDA_URL, 302);
