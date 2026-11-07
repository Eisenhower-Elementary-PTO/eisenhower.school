// The public front page: everything waiting to be claimed, newest first, with
// search and two filters. Needs no session — it reads `/lostfound-public/*`,
// which serves the public projection only (invariant 33): no writing read off
// an item, no claims, nothing about who found it.
//
// Filter state lives in the URL so a search can be shared ("is this your
// kid's?") and survives the back button from an item page.
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LF_CATEGORIES, LF_COLORS, type LfPublicItemDTO } from "@sd/shared";
import { Screen } from "../components/Screen.js";
import { ItemCard, Swatch } from "../components/items.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { api } from "../lib/api.js";
import { categoryLabel, colorLabel } from "../lib/lf.js";

export function Browse() {
  const { t } = useI18n();
  const { me, loading: sessionLoading } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const color = params.get("color") ?? "";

  const [draft, setDraft] = useState(q);
  const [items, setItems] = useState<LfPublicItemDTO[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState(false);
  // A newer search can finish before an older one; only the newest may render.
  const seq = useRef(0);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // The URL can change under the box (the back button); follow it, without
  // fighting someone mid-word over a trailing space.
  useEffect(() => {
    setDraft((d) => (d.trim() === q ? d : q));
  }, [q]);

  // Debounce typing into the URL; the URL drives the fetch below.
  useEffect(() => {
    if (draft.trim() === q) return;
    const timer = setTimeout(() => setParam("q", draft.trim()), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const load = async (nextPage: number) => {
    const mine = ++seq.current;
    setError(false);
    try {
      const res = await api.browse({ q, category, color, page: nextPage });
      if (mine !== seq.current) return;
      setItems((prev) => (nextPage === 0 || !prev ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
      setHasMore(res.hasMore);
      setPage(nextPage);
    } catch {
      if (mine === seq.current) setError(true);
    }
  };

  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, color]);

  const filtered = !!(q || category || color);

  return (
    <Screen active="browse" title={t("navLostFound")}>
      <div className="lf-page">
        <div>
          <h1 className="sd-h1">{t("lfBrowseTitle")}</h1>
          <p className="sd-lead" style={{ marginTop: 8 }}>{t("lfBrowseLead")}</p>
          <p className="sd-meta" style={{ marginTop: 6 }}>
            <a
              className="sd-link"
              href="https://www.amazon.com/Avery-Fabric-Labels-Handwrite-32130/dp/B08PF2162N"
              target="_blank"
              rel="noreferrer"
            >
              {t("lfLabelTip")}
            </a>
          </p>
          {/* The whole listing's size, steady while someone searches or
              filters. Zero says nothing — the empty grid already does. */}
          {total !== null && total > 0 && (
            <p className="sd-meta" style={{ marginTop: 6 }}>
              {total === 1 ? t("lfItemCountOne") : t("lfItemCount", { n: total })}
            </p>
          )}
        </div>

        <form
          className="lf-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", draft.trim());
          }}
        >
          <input
            className="sd-input"
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("lfSearchPlaceholder")}
            aria-label={t("lfSearchLabel")}
            autoComplete="off"
            enterKeyHint="search"
          />
        </form>

        <div className="lf-filters">
          <select
            className="sd-input"
            aria-label={t("lfCategoryLabel")}
            value={category}
            onChange={(e) => setParam("category", e.target.value)}
          >
            <option value="">{t("lfAllCategories")}</option>
            {LF_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(t, c)}
              </option>
            ))}
          </select>
          <div className="lf-filters" role="group" aria-label={t("lfColorLabel")}>
            {LF_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="lf-chip"
                aria-pressed={color === c}
                onClick={() => setParam("color", color === c ? "" : c)}
              >
                <Swatch color={c} />
                {colorLabel(t, c)}
              </button>
            ))}
          </div>
        </div>

        {q && items && items.length > 0 && <p className="sd-meta">{t("lfBestMatches", { q })}</p>}
        {error && <div className="lf-notice warn" role="alert">{t("lfLoadError")}</div>}

        {items === null && !error ? (
          <div className="sd-boot" style={{ minHeight: 160 }}>
            <div className="sd-spinner" />
          </div>
        ) : (
          <div className="lf-grid">
            {items && items.length === 0 && (
              <div className="lf-empty">{filtered ? t("lfNoMatches") : t("lfEmpty")}</div>
            )}
            {items?.map((item) => (
              <ItemCard
                key={item.id}
                to={`/item/${item.id}`}
                item={{ ...item, untitled: item.pending || !item.title }}
              />
            ))}
          </div>
        )}

        {hasMore && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button type="button" className="sd-btn sd-btn-ghost" onClick={() => void load(page + 1)}>
              {t("lfShowMore")}
            </button>
          </div>
        )}

        {/* The way in for someone who FOUND something: any signed-in member may
            add an item (it goes to the office's review queue), and staff reach
            their screens through the same sign-in. Quiet on purpose — browsing
            and claiming never need an account, and shouldn't look like they
            do. */}
        {!sessionLoading && (
          <p className="sd-meta" style={{ textAlign: "center", marginTop: 8 }}>
            <Link className="sd-link" to={me ? "/submit" : "/sign-in"}>
              {me ? t("lfSubmitTitle") : t("lfSignInToAdd")}
            </Link>
          </p>
        )}
      </div>
    </Screen>
  );
}
