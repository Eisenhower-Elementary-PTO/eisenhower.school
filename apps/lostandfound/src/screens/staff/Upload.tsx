// Rapid add: stage a batch of photos, then add them all at once.
//
// Choosing or snapping photos only STAGES them — each is resized right away
// (lib/lf.ts, which also strips EXIF, GPS included) and shown in a tray where a
// mis-shot can be removed. "Add N items" then uploads the tray, a few at a
// time, and each item's description starts the moment its thumbnail lands.
//
// Each photo is still two requests: the full-size photo creates the item, then
// the thumbnail starts the vision model. Both are raw JPEG bodies, not
// multipart — see lib/api.ts — and one body carries one image.
//
// UPLOAD_CONCURRENCY is small on purpose: a phone on school Wi-Fi does better
// with a short queue than with thirty parallel uploads. Progress is one
// `?ids=` read for the whole batch every few seconds, not a poll per photo.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LfStaffItemDTO } from "@sd/shared";
import { Screen } from "../../components/Screen.js";
import { Icon } from "../../components/Icon.js";
import { Btn } from "../../components/atoms.js";
import { api, errorMessage } from "../../lib/api.js";
import { resizePhoto, rotatePhoto, turnFor, turnWord, type Turn } from "../../lib/lf.js";

const LOCATION_KEY = "lf_last_location";
const UPLOAD_CONCURRENCY = 3;
const POLL_MS = 3000;
/** Stop checking after this long; anything still describing shows on the dashboard. */
const POLL_FOR_MS = 3 * 60 * 1000;
const IDS_PER_READ = 50;

function readLocation(): string {
  try {
    return localStorage.getItem(LOCATION_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLocation(value: string): void {
  try {
    localStorage.setItem(LOCATION_KEY, value);
  } catch {
    /* private mode — the field simply starts empty next time */
  }
}

/** A photo in the tray, resized and waiting for "Add". */
interface Staged {
  key: string;
  name: string;
  preview: string;
  photo: Blob;
  thumb: Blob;
}

type Phase = "waiting" | "uploading" | "describing" | "live" | "held" | "failed" | "error" | "slow";

/** A photo that has been submitted. */
interface Row {
  key: string;
  name: string;
  preview: string;
  phase: Phase;
  title: string;
  error: string;
  itemId: string | null;
  /** Kept so the AI's rotation suggestion can be applied without a download. */
  photo: Blob;
  /** The AI's suggested turn, once it has looked; null when it thinks it's upright. */
  turn: Turn | null;
  turning: boolean;
  /** Auto-apply has been attempted once; a failure leaves the manual button. */
  autoTried?: boolean;
}

const PHASE_TEXT: Record<Phase, (r: Row) => string> = {
  waiting: () => "Waiting to upload…",
  uploading: () => "Uploading…",
  describing: () => "The AI is describing it…",
  live: (r) => `✓ Live: ${r.title}`,
  held: () => "Held for review: writing detected",
  failed: () => "Held for review: the AI couldn't describe it. Open it to check and fill it in.",
  error: (r) => r.error,
  slow: () => "Still describing — check the dashboard in a minute.",
};
const WARN: Phase[] = ["held", "failed", "error"];

let nextKey = 0;

export function Upload() {
  const [location, setLocation] = useState(readLocation);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [prepError, setPrepError] = useState("");
  const [rotating, setRotating] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const uploading = rows.some((r) => r.phase === "waiting" || r.phase === "uploading");

  // Leaving mid-upload loses whatever hasn't been sent yet, so say so.
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  // One status read for every item still being described.
  const describing = rows.filter((r) => r.phase === "describing" && r.itemId).map((r) => r.itemId!);
  const describingKey = describing.join(",");
  const pollStart = useRef(0);
  useEffect(() => {
    if (!describing.length) {
      pollStart.current = 0;
      return;
    }
    if (!pollStart.current) pollStart.current = Date.now();
    const timer = setTimeout(async () => {
      if (Date.now() - pollStart.current > POLL_FOR_MS) {
        setRows((rs) => rs.map((r) => (r.phase === "describing" ? { ...r, phase: "slow" } : r)));
        return;
      }
      const found: LfStaffItemDTO[] = [];
      for (let i = 0; i < describing.length; i += IDS_PER_READ) {
        try {
          found.push(...(await api.staffItemsByIds(describing.slice(i, i + IDS_PER_READ))).items);
        } catch {
          /* a missed read is retried on the next tick */
        }
      }
      const byId = new Map(found.map((it) => [it.id, it]));
      setRows((rs) =>
        rs.map((r) => {
          const it = r.itemId ? byId.get(r.itemId) : undefined;
          if (r.phase !== "describing" || !it || it.tagStatus === "pending") return r;
          if (it.tagStatus === "failed") return { ...r, phase: "failed" };
          return { ...r, phase: it.heldAt ? "held" : "live", title: it.title, turn: turnFor(it.suggestedRotation) };
        }),
      );
    }, POLL_MS);
    return () => clearTimeout(timer);
    // Re-armed after every change to the rows, which is what makes it a loop:
    // each read updates the rows, which schedules the next read.
  }, [describingKey, rows]);

  /** Resize each chosen photo into the tray, one at a time to spare the phone. */
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    if (input.current) input.current.value = "";
    setPrepError("");
    setPreparing((n) => n + list.length);
    for (const file of list) {
      try {
        const { photo, thumb } = await resizePhoto(file);
        setStaged((s) => [
          ...s,
          { key: `s${nextKey++}`, name: file.name, preview: URL.createObjectURL(thumb), photo, thumb },
        ]);
      } catch {
        setPrepError(`This browser can't read “${file.name}”. Try taking it with the camera instead.`);
      } finally {
        setPreparing((n) => n - 1);
      }
    }
  };

  const unstage = (key: string) =>
    setStaged((s) => {
      const gone = s.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return s.filter((x) => x.key !== key);
    });

  /** Turn a staged photo a quarter. Both images are re-made from the full-size
   *  one, so the thumbnail the AI reads turns with it. */
  const rotate = async (key: string, turn: Turn) => {
    const item = staged.find((x) => x.key === key);
    if (!item || rotating.includes(key)) return;
    setRotating((r) => [...r, key]);
    try {
      const { photo, thumb } = await rotatePhoto(item.photo, turn);
      const preview = URL.createObjectURL(thumb);
      setStaged((s) => s.map((x) => (x.key === key ? { ...x, photo, thumb, preview } : x)));
      URL.revokeObjectURL(item.preview);
    } catch {
      setPrepError(`Couldn't rotate “${item.name}”.`);
    } finally {
      setRotating((r) => r.filter((k) => k !== key));
    }
  };

  const uploadOne = async (item: Staged, where: string) => {
    update(item.key, { phase: "uploading" });
    try {
      const created = await api.uploadPhoto(item.photo, where);
      update(item.key, { itemId: created.id });
      // The thumbnail landing is what starts the vision model (routes/lostFound.ts).
      await api.uploadThumb(created.id, item.thumb);
      update(item.key, { phase: "describing" });
    } catch (err) {
      update(item.key, {
        phase: "error",
        error: errorMessage(err, "Upload failed. Check the connection and try again."),
      });
    }
  };

  /** Apply the AI's suggested turn to an uploaded item: re-made from the photo
   *  still in memory and sent back. The description stands — it's the same item. */
  const applyTurn = async (r: Row) => {
    if (!r.itemId || !r.turn || r.turning) return;
    update(r.key, { turning: true });
    try {
      const { photo, thumb } = await rotatePhoto(r.photo, r.turn);
      await api.replacePhoto(r.itemId, photo, r.turn);
      await api.uploadThumb(r.itemId, thumb);
      URL.revokeObjectURL(r.preview);
      update(r.key, { photo, preview: URL.createObjectURL(thumb), turn: null, turning: false });
    } catch {
      update(r.key, { turning: false });
    }
  };

  // The AI said it's turned: just turn it (once; a failure leaves the button).
  useEffect(() => {
    for (const r of rows) {
      if (r.turn && r.itemId && !r.turning && !r.autoTried && (r.phase === "held" || r.phase === "live")) {
        update(r.key, { autoTried: true });
        void applyTurn(r);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  /** "Add N items": every staged photo, UPLOAD_CONCURRENCY at a time. */
  const submit = async () => {
    const batch = staged;
    if (!batch.length) return;
    const where = location.trim();
    saveLocation(where);
    setStaged([]);
    setRows((rs) => [
      ...batch.map((s) => ({
        key: s.key,
        name: s.name,
        preview: s.preview,
        phase: "waiting" as Phase,
        title: "",
        error: "",
        itemId: null,
        photo: s.photo,
        turn: null,
        turning: false,
      })),
      ...rs,
    ]);
    let next = 0;
    const worker = async () => {
      while (next < batch.length) await uploadOne(batch[next++]!, where);
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, batch.length) }, worker));
  };

  const count = (phases: Phase[]) => rows.filter((r) => phases.includes(r.phase)).length;
  const summary = rows.length
    ? [
        `${count(["live"])} live`,
        `${count(["held", "failed"])} held for review`,
        count(["waiting", "uploading", "describing"]) && `${count(["waiting", "uploading", "describing"])} in progress`,
        count(["error"]) && `${count(["error"])} failed to upload`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <Screen active="staff" title="Add found items" back="/staff">
      <div className="lf-page lf-narrow">
        <p className="sd-lead" style={{ margin: 0 }}>
          One item per photo, on a plain background if you can, and with no children in the frame. Snap or choose as
          many as you like, then add them all at once — the AI describes each one as it lands.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="sd-label" htmlFor="lf-location">Where were they found? (optional)</label>
          <input
            id="lf-location"
            className="sd-input"
            value={location}
            maxLength={120}
            placeholder="e.g. Gym, playground, cafeteria"
            onChange={(e) => setLocation(e.target.value)}
            onBlur={() => saveLocation(location.trim())}
          />
          <span className="sd-meta">Applies to every photo in this batch.</span>
        </div>

        <label className="lf-drop">
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
            onChange={(e) => void onFiles(e.target.files)}
          />
          <Icon name="upload" size={28} />
          <strong style={{ fontSize: 17 }}>{staged.length ? "Add more photos" : "Take or choose photos"}</strong>
          <span className="sd-meta">Pick several at once, or snap one after another. Tap ↻ on any that came out sideways.</span>
        </label>
        <div className="lf-notice">
          Turn names and labels away from the camera — items with writing are held for review before they appear
          publicly.
        </div>
        {prepError && <div className="lf-notice warn" role="alert">{prepError}</div>}

        {(staged.length > 0 || preparing > 0) && (
          <section className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="lf-tray" aria-label="Photos ready to add">
              {staged.map((s) => (
                <div key={s.key} className="lf-tray-item">
                  <img src={s.preview} alt={`Photo ${s.name}`} />
                  <button type="button" aria-label={`Remove ${s.name}`} onClick={() => unstage(s.key)}>
                    ×
                  </button>
                  <button
                    type="button"
                    className="lf-tray-rotate"
                    aria-label={`Rotate ${s.name}`}
                    title="Rotate"
                    disabled={rotating.includes(s.key)}
                    onClick={() => void rotate(s.key, "cw")}
                  >
                    ↻
                  </button>
                </div>
              ))}
              {Array.from({ length: preparing }, (_, i) => (
                <div key={`p${i}`} className="lf-tray-item lf-tray-pending" aria-label="Preparing a photo">
                  <div className="sd-spinner" />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Btn disabled={!staged.length || preparing > 0 || rotating.length > 0} onClick={() => void submit()}>
                {staged.length === 1 ? "Add 1 item" : `Add ${staged.length} items`}
              </Btn>
              <Btn kind="ghost" disabled={!staged.length} onClick={() => staged.forEach((s) => unstage(s.key))}>
                Clear
              </Btn>
              {preparing > 0 && <span className="sd-meta">Preparing {preparing}…</span>}
            </div>
          </section>
        )}

        {summary && (
          <p className="sd-meta" aria-live="polite" style={{ margin: 0, fontWeight: 600 }}>
            {summary}
          </p>
        )}

        <div className="lf-queue">
          {rows.map((r) => (
            <div key={r.key} className="lf-queue-row">
              <img src={r.preview} alt="" />
              <div style={{ minWidth: 0 }}>
                <div className="sd-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: WARN.includes(r.phase) ? "var(--orange-ink)" : r.phase === "live" ? "var(--ok)" : "var(--ink)",
                  }}
                >
                  {PHASE_TEXT[r.phase](r)}
                </div>
              </div>
              {r.itemId && (
                <div className="lf-queue-actions">
                  {r.turn && (
                    <button
                      type="button"
                      className="sd-btn sd-btn-secondary sd-btn-sm"
                      title={`The AI thinks this photo is ${turnWord(r.turn)}`}
                      disabled={r.turning}
                      onClick={() => void applyTurn(r)}
                    >
                      {r.turning ? "Turning…" : `${r.turn === "ccw" ? "↺" : "↻"} Looks ${turnWord(r.turn)} — fix`}
                    </button>
                  )}
                  <Link className="sd-btn sd-btn-ghost sd-btn-sm" to={`/staff/item/${r.itemId}`}>
                    {WARN.includes(r.phase) ? "Review" : "Edit"}
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
