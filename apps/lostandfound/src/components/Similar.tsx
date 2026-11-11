// Staff-only views over the similarity index (invariant 33, migration 0046):
// "seen before" on an item, and the dashboard's "keeps getting lost" list.
// Both show a child's name and room, so they live on staff screens only.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LfRepeatGroupDTO, LfSimilarDTO, LfSimilarReason } from "@sd/shared";
import { Tag } from "./atoms.js";
import { Swatch } from "./items.js";
import { useI18n } from "../i18n/index.js";
import { api, errorMessage } from "../lib/api.js";
import { formatDay } from "../lib/lf.js";

const REASON: Record<LfSimilarReason, string> = {
  look: "Looks alike",
  color: "Same colors",
  brand: "Same brand",
  writing: "Same name on it",
};

/** Where this one ended up, in a sentence. */
function ending(s: LfSimilarDTO, locale: Parameters<typeof formatDay>[1]): string {
  if (s.here) return "Still here";
  if (!s.returnedAt) return "Left without being claimed";
  const who = [s.returnedTo, s.returnedRoom].filter(Boolean).join(" · ");
  return `Returned ${formatDay(s.returnedAt, locale)}${who ? ` to ${who}` : ""}`;
}

function SimilarRow({ s }: { s: LfSimilarDTO }) {
  const { locale } = useI18n();
  const body = (
    <>
      {s.thumbUrl ? (
        <img src={s.thumbUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, flex: "none" }} />
      ) : (
        <div className="sd-meta" style={{ width: 56, height: 56, display: "grid", placeItems: "center", flex: "none", textAlign: "center", fontSize: 11 }}>
          Photo gone
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <b style={{ overflowWrap: "anywhere" }}>{s.title}</b>
        <span className="sd-meta">
          Found {formatDay(s.foundAt, locale)} · {ending(s, locale)}
        </span>
        <span className="lf-tags">
          {s.colors.map((c) => (
            <Swatch key={c} color={c} />
          ))}
          {s.reasons.map((r) => (
            <Tag key={r} tone="blue">{REASON[r]}</Tag>
          ))}
        </span>
      </div>
    </>
  );
  const style = { display: "flex", gap: 10, alignItems: "flex-start", color: "inherit", textDecoration: "none" } as const;
  return s.itemId ? (
    <Link to={`/staff/item/${s.itemId}`} style={style}>{body}</Link>
  ) : (
    <div style={style}>{body}</div>
  );
}

/** On an item's page: has something like this come in before, and where did it go? */
export function SeenBefore({ itemId, ready }: { itemId: string; ready: boolean }) {
  const [similar, setSimilar] = useState<LfSimilarDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `ready` flips when the AI has described the item: before that there is no
  // fingerprint to compare, and the answer would be a misleading "nothing".
  useEffect(() => {
    if (!ready) return;
    let live = true;
    api
      .similarItems(itemId)
      .then((r) => live && setSimilar(r.similar))
      .catch((err) => live && setError(errorMessage(err, "Couldn't look for similar items.")));
    return () => {
      live = false;
    };
  }, [itemId, ready]);

  if (!ready) return null;
  return (
    <section className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 className="sd-h2">Seen before</h2>
      {error && <div className="lf-notice warn" role="alert">{error}</div>}
      {similar === null && !error && <div className="sd-meta">Looking…</div>}
      {similar?.length === 0 && <div className="sd-meta">Nothing like this has come in, going back a year.</div>}
      {similar?.map((s) => <SimilarRow key={`${s.itemId ?? s.foundAt}-${s.title}`} s={s} />)}
    </section>
  );
}

/** On the dashboard: the things that keep turning up. Loaded when opened. */
export function RepeatsPanel() {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<LfRepeatGroupDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || groups) return;
    api
      .repeatGroups()
      .then((r) => setGroups(r.groups))
      .catch((err) => setError(errorMessage(err, "Couldn't load repeat items.")));
  }, [open, groups]);

  return (
    <details className="sd-card sd-card-pad" onToggle={(e) => setOpen(e.currentTarget.open)} style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Keeps getting lost</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 10 }}>
        <p className="sd-meta" style={{ margin: 0 }}>
          Items that look like ones found before, over the last year. Who they went home to is listed so the next one can go straight there.
        </p>
        {error && <div className="lf-notice warn" role="alert">{error}</div>}
        {open && !groups && !error && <div className="sd-meta">Looking…</div>}
        {groups?.length === 0 && <div className="sd-meta">Nothing has turned up more than once yet.</div>}
        {groups?.map((g) => (
          <div key={g.items[0]!.itemId ?? g.lastFoundAt} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <b>{g.title}</b> · found {g.count} times
              <div className="sd-meta">
                {formatDay(g.firstFoundAt, locale)} to {formatDay(g.lastFoundAt, locale)}
                {g.returnedTo.length > 0 && ` · went home to ${g.returnedTo.join(", ")}`}
              </div>
            </div>
            {g.items.map((s) => (
              <SimilarRow key={`${s.itemId ?? s.foundAt}-${s.title}`} s={s} />
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
