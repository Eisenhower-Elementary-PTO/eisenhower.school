// Lost & found settings. System admins only.
//
// Two levers. The staff GROUP decides who can upload, edit and read claimants'
// contact details, which is why the route behind it is audited
// (`lostfound.staff.configured`). The group is an ordinary `generic` group,
// created and rostered in the directory — there is no second membership model.
// With nothing chosen, only system admins are admitted. That is the bootstrap
// state rather than a broken one, and the copy says so.
//
// The CLAIM NOTIFICATION list is the addresses mailed the moment someone says
// "that's mine" on an item. The email names the item and links to the queue;
// the claimant's details stay behind a session (lib/email.ts in the API).
import { useEffect, useState } from "react";
import { Screen } from "../../components/Screen.js";
import { Btn } from "../../components/atoms.js";
import { api, errorMessage, DIRECTORY_URL } from "../../lib/api.js";
import { useAccess } from "../../lib/access.js";

interface GroupRow {
  id: string;
  name: string;
  memberCount: number;
}

function Body() {
  const { access, refresh } = useAccess();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .groups()
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
  }, []);

  const choose = async (groupId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.setGroup(groupId);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 620 }}>
      <div>
        <h2 className="sd-h2" style={{ margin: 0 }}>
          Who runs the lost and found
        </h2>
        <p className="sd-lead" style={{ marginTop: 8 }}>
          Pick the group whose roster is lost &amp; found staff. Anyone who controls a Person on it can add
          items, edit them and see claimants&apos; contact details; system admins always can. Until you
          pick one, only system admins can.
        </p>
        <p className="sd-meta" style={{ marginTop: 8 }}>
          Groups and their rosters are managed in the directory —{" "}
          <a className="sd-link" href={`${DIRECTORY_URL}/groups`}>
            directory.eisenhower.school
          </a>
          . Only <b>generic</b> groups are offered here: a household or a classroom is a different
          kind of thing and shouldn't double as a committee.
        </p>
      </div>

      {error && <div className="sd-meta" style={{ color: "var(--warn)" }}>{error}</div>}

      {groups === null ? (
        <div className="sd-meta">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="sd-card sd-card-pad">
          <div style={{ fontWeight: 700 }}>No groups yet</div>
          <p className="sd-meta" style={{ marginTop: 6 }}>
            Create one in the directory (Admin → Groups), add the staff who run the lost and found,
            then come back here.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map((g) => {
            const on = access?.groupId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                className="sd-row"
                disabled={busy}
                onClick={() => void choose(on ? null : g.id)}
                style={{
                  gap: 12,
                  padding: "13px 14px",
                  borderRadius: 12,
                  width: "100%",
                  textAlign: "left",
                  font: "inherit",
                  cursor: "pointer",
                  border: `1px solid ${on ? "var(--blue)" : "var(--line)"}`,
                  background: on ? "var(--blue-tint)" : "var(--paper)",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{g.name}</div>
                  <div className="sd-meta">
                    {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                  </div>
                </div>
                {on && <span className="sd-meta" style={{ fontWeight: 700 }}>Selected</span>}
              </button>
            );
          })}
        </div>
      )}

      {access?.groupId && (
        <Btn kind="ghost" disabled={busy} onClick={() => void choose(null)}>
          Clear — system admins only
        </Btn>
      )}

      <ClaimNotifications />
    </div>
  );
}

/** Who gets an email when a claim arrives. One address per line; saving an
 *  empty box turns the mail off. The server validates each address and refuses
 *  the whole save on a typo, so what reads as saved is what will be mailed. */
function ClaimNotifications() {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .settings()
      .then((s) => setText(s.claimNotifyEmails.join("\n")))
      .catch(() => setText(""));
  }, []);

  const save = async () => {
    if (text === null) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.setClaimEmails(text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean));
      setText(res.claimNotifyEmails.join("\n"));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 18 }}>
      <h2 className="sd-h2" style={{ margin: 0 }}>
        Claim notifications
      </h2>
      <p className="sd-lead" style={{ marginTop: 8 }}>
        These addresses get an email the moment someone claims an item. The email names the item and
        links to the claims queue — the claimant&apos;s contact details stay on the staff screens.
        Leave it empty to send nothing.
      </p>
      {text === null ? (
        <div className="sd-meta" style={{ marginTop: 10 }}>Loading…</div>
      ) : (
        <>
          <textarea
            className="sd-input"
            rows={4}
            value={text}
            placeholder={"office@school.example\npto-president@example.com"}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
            style={{ marginTop: 10, width: "100%", resize: "vertical", font: "inherit" }}
          />
          <p className="sd-meta" style={{ marginTop: 6 }}>One address per line.</p>
          {error && <div className="sd-meta" style={{ marginTop: 6, color: "var(--warn)" }}>{error}</div>}
          <div className="sd-row" style={{ gap: 10, marginTop: 10 }}>
            <Btn disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save addresses"}
            </Btn>
            {saved && <span className="sd-meta">Saved.</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function Settings() {
  return (
    <Screen active="settings" title="Settings" back="/staff">
      <Body />
    </Screen>
  );
}
