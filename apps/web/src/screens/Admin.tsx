// Admin console: registration toggle, masquerade (user list), the append-only
// audit log, and whole-database backup/restore. CSV bulk import + co-manager invite UI remain M4.
// Admin chrome is intentionally English-only (operator tooling).
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type {
  AccessRequestDTO,
  AdminUserDTO,
  AuditActionCountDTO,
  AuditEntryDTO,
  BackupDocument,
  NewUserNotify,
  RestoreReportDTO,
  UserDeletionImpactDTO,
} from "@sd/shared";
import { CLOCK, RESTORE_CONFIRM } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Avatar, Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { IconBtn, ScreenHeader, SectLabel, SheetOver } from "../components/parts.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, ApiError, CALENDAR_APP_URL, NEWSLETTER_APP_URL } from "../lib/api.js";

/** A row's detail as one line of `key: value` pairs, for scanning and for
 *  showing why a search matched. Nested values are shown as JSON. */
function detailLine(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  return Object.entries(detail)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", ...CLOCK });
  } catch {
    return iso;
  }
}

/** Notifications for the signed-in admin ONLY: new members (a switch plus,
 *  when on, the delivery mode) and access requests (a switch). Each admin
 *  chooses for themselves (migrations 0026, 0034); both default off. */
function NotificationsSection() {
  const [mode, setMode] = useState<NewUserNotify | null>(null);
  const [accessOn, setAccessOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .getNotifications()
      .then((r) => {
        setMode(r.newUser);
        setAccessOn(r.accessRequest);
      })
      .catch(() => {
        setMode(null);
        setAccessOn(null);
      });
  }, []);

  const save = async (next: NewUserNotify) => {
    const prev = mode;
    setMode(next); // optimistic
    setBusy(true);
    try {
      const r = await api.setNotifications({ newUser: next });
      setMode(r.newUser);
    } catch {
      setMode(prev ?? null); // revert on failure
    } finally {
      setBusy(false);
    }
  };

  const saveAccess = async (next: boolean) => {
    const prev = accessOn;
    setAccessOn(next); // optimistic
    setBusy(true);
    try {
      const r = await api.setNotifications({ accessRequest: next });
      setAccessOn(r.accessRequest);
    } catch {
      setAccessOn(prev); // revert on failure
    } finally {
      setBusy(false);
    }
  };

  const on = mode !== null && mode !== "off";
  const choices: [NewUserNotify, string, string][] = [
    ["instant", "Right away", "One email per person, as they join."],
    ["daily", "Daily digest", "One summary each morning (~8am), only if anyone joined."],
  ];

  return (
    <div style={{ marginTop: 18 }}>
      <SectLabel>Notifications</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        <div className="sd-row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Email me about new members</div>
            <div className="sd-meta" style={{ marginTop: 2, lineHeight: 1.4 }}>
              {on
                ? "You get a notice when someone signs up or accepts an invite."
                : "You aren't emailed when someone joins."}
            </div>
          </div>
          <button
            className={`sd-toggle${on ? " on" : ""}`}
            aria-pressed={on}
            aria-label="Toggle new-member notifications"
            disabled={mode === null || busy}
            onClick={() => void save(on ? "off" : "instant")}
          />
        </div>

        {on && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {choices.map(([value, label, help]) => (
              <label key={value} className="sd-row" style={{ gap: 9, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="new-user-notify"
                  checked={mode === value}
                  disabled={busy}
                  onChange={() => void save(value)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</span>
                  <span className="sd-meta" style={{ display: "block", lineHeight: 1.4 }}>{help}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="sd-row" style={{ gap: 12, marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Email me about directory requests</div>
            <div className="sd-meta" style={{ marginTop: 2, lineHeight: 1.4 }}>
              {accessOn
                ? "You get a notice each time someone asks for access to the directory."
                : "You aren't emailed about access requests — check the Access tab for anyone waiting."}
            </div>
          </div>
          <button
            className={`sd-toggle${accessOn ? " on" : ""}`}
            aria-pressed={!!accessOn}
            aria-label="Toggle directory request notifications"
            disabled={accessOn === null || busy}
            onClick={() => void saveAccess(!accessOn)}
          />
        </div>

        <div className="sd-meta" style={{ marginTop: 10, lineHeight: 1.4 }}>
          This is just for you — each admin chooses their own, and other admins' choices
          aren't changed by yours. Accounts created from this console don't send a notice.
        </div>
      </div>
    </div>
  );
}

/** Create a sign-in account, optionally suppressing the welcome email. */
/** What a permanent delete would remove, read before anything irreversible.
 *
 *  Nothing here deletes: permanent deletion is not built yet, deliberately. The
 *  sheet exists so the shape of the damage is visible first — and because the
 *  honest answer is usually "less is exclusively theirs than you would think".
 *  A child with two parents belongs to both; a classroom belongs to the school. */
function DeletionImpactSheet({
  user, onClose, onDeleted,
}: { user: AdminUserDTO; onClose: () => void; onDeleted: () => void }) {
  const [impact, setImpact] = useState<UserDeletionImpactDTO | null>(null);
  const [error, setError] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .userDeletionImpact(user.id)
      .then((r) => alive && setImpact(r))
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [user.id]);

  // Two gates before the button does anything: the account must already be
  // disabled (the reversible step first), and the admin must type the email —
  // friction to match an unrecoverable act. Both mirror the server's guards.
  const emailMatches = confirm.trim().toLowerCase() === user.email.toLowerCase();
  const canDelete = user.disabled && emailMatches && !deleting;

  const del = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteUser(user.id);
      onDeleted();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError && err.status === 409
          ? "The account has to be disabled before it can be deleted."
          : "Couldn't delete that account.",
      );
      setDeleting(false);
    }
  };

  return (
    <SheetOver onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h2 className="sd-h2">Delete {user.email}</h2>
          <p className="sd-meta" style={{ marginTop: 4 }}>
            {user.disabled
              ? "Permanently removes the account and everything below. This can't be undone."
              : "Disable the account first — permanent deletion is only offered once it's out of use."}
          </p>
        </div>

        {error && <p className="sd-meta" style={{ color: "var(--warn)" }}>Couldn't load the impact report.</p>}
        {!impact && !error && <div className="sd-spinner" />}

        {impact && (
          <>
            <ImpactBlock
              tone="warn"
              title={`${impact.orphanedPersons.length} would be deleted`}
              note="Nobody else controls these, so no one could sign in and edit them afterwards."
              items={impact.orphanedPersons.map((p) => p.name)}
            />
            <ImpactBlock
              tone="ok"
              title={`${impact.sharedPersons.length} would be kept`}
              note="Someone else controls these too. Only this account's control would be dropped."
              items={impact.sharedPersons.map((p) => `${p.name} — also controlled by ${p.otherControllers}`)}
            />
            <ImpactBlock
              tone="warn"
              title={`${impact.emptiedHouseholds.length} household(s) would be deleted`}
              note="Left with no members at all. Households that still have someone in them stay."
              items={impact.emptiedHouseholds.map((g) => g.name)}
            />
            <ImpactBlock
              tone="ok"
              title={`${impact.retainedGroupsAdministered.length} group(s) would be kept`}
              note="Classrooms and school groups are never deleted with a member — but these would lose an admin."
              items={impact.retainedGroupsAdministered.map((g) => `${g.name} (${g.kind})`)}
            />
            {(impact.volunteerClaimsWithdrawn > 0 || impact.boardCommentsDeleted > 0 || impact.sharesWithdrawn > 0) && (
              <ImpactBlock
                tone="warn"
                title="Account activity would be removed"
                note="Tied to the account itself, so nothing else holds these."
                items={[
                  ...(impact.volunteerClaimsWithdrawn > 0
                    ? [`${impact.volunteerClaimsWithdrawn} volunteer claim(s) given back`]
                    : []),
                  ...(impact.boardCommentsDeleted > 0
                    ? [`${impact.boardCommentsDeleted} PTO board comment(s) deleted`]
                    : []),
                  ...(impact.sharesWithdrawn > 0
                    ? [`${impact.sharesWithdrawn} shared field(s) unshared — a co-parent can share them again`]
                    : []),
                ]}
              />
            )}
            <p className="sd-meta" style={{ lineHeight: 1.5 }}>
              {impact.auditEntries} audit entr{impact.auditEntries === 1 ? "y" : "ies"} would be kept.
              The log is append-only and hash-chained, so removing rows would break
              tamper-evidence and erase the record of what this account did.
            </p>
          </>
        )}

        {impact && !user.disabled && <Btn kind="secondary" block onClick={onClose}>Close</Btn>}

        {impact && user.disabled && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="sd-meta" htmlFor="confirm-delete-email">
              Type <b>{user.email}</b> to confirm
            </label>
            <input
              id="confirm-delete-email"
              className="sd-input"
              type="email"
              autoComplete="off"
              value={confirm}
              placeholder={user.email}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {deleteError && <p className="sd-meta" style={{ color: "var(--warn)" }}>{deleteError}</p>}
            <div className="sd-row" style={{ gap: 8 }}>
              <Btn kind="secondary" block onClick={onClose} disabled={deleting}>Cancel</Btn>
              <button
                type="button"
                className="sd-btn sd-btn-primary block"
                style={{ background: "var(--warn)", borderColor: "var(--warn)" }}
                disabled={!canDelete}
                onClick={() => void del()}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        )}
      </div>
    </SheetOver>
  );
}

function ImpactBlock({
  tone, title, note, items,
}: { tone: "warn" | "ok"; title: string; note: string; items: string[] }) {
  const color = tone === "warn" ? "var(--warn)" : "var(--ink-2)";
  return (
    <div className="sd-card sd-card-pad" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{title}</div>
      <div className="sd-meta" style={{ marginTop: 3, lineHeight: 1.4 }}>{note}</div>
      {items.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {items.map((x) => (
            <li key={x} className="sd-meta" style={{ lineHeight: 1.5 }}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [sysAdmin, setSysAdmin] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ email: email.trim(), isSystemAdmin: sysAdmin, sendEmail });
      setEmail("");
      setSysAdmin(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "That email already has an account." : "Couldn't create the user.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
      <input className="sd-input" type="email" placeholder="new.member@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="sd-row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
        Email them a sign-in link
      </label>
      <label className="sd-row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={sysAdmin} onChange={(e) => setSysAdmin(e.target.checked)} />
        System admin
      </label>
      <div className="sd-meta" style={{ lineHeight: 1.4 }}>
        The account works immediately; they can sign in any time via “Email me a link” even with sign-ups closed.
      </div>
      <Btn type="submit" icon="plus" disabled={busy || !email.trim()}>Create user</Btn>
      {error && <div className="sd-meta" style={{ color: "var(--warn)" }}>{error}</div>}
    </form>
  );
}

/** Backup + restore.
 *
 *  The two halves are deliberately asymmetric. Downloading is one button,
 *  because the thing that stops people taking backups is friction. Restoring is
 *  a file, then a dry run nobody can skip, then a word typed by hand — because
 *  the thing that ruins directories is a confident click.
 *
 *  The API defaults to a dry run when the flag is missing, so this screen's
 *  two-step flow is a second lock rather than the only one.
 */
function BackupTab() {
  const [busy, setBusy] = useState<null | "download" | "preview" | "restore">(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [doc, setDoc] = useState<BackupDocument | null>(null);
  const [report, setReport] = useState<RestoreReportDTO | null>(null);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState<RestoreReportDTO | null>(null);

  const download = async () => {
    setBusy("download");
    setError(null);
    try {
      const backup = await api.downloadBackup();
      // Saved from the parsed document rather than streamed straight to disk so
      // a failure is an error message instead of a 0-byte file.
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `school-directory-backup-${backup.generatedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't download the backup.");
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File) => {
    setError(null);
    setReport(null);
    setDone(null);
    setTyped("");
    setFileName(file.name);
    let parsed: BackupDocument;
    try {
      parsed = JSON.parse(await file.text()) as BackupDocument;
    } catch {
      setDoc(null);
      setError("That file isn't valid JSON.");
      return;
    }
    setDoc(parsed);
    setBusy("preview");
    try {
      setReport(await api.restorePreview(parsed));
    } catch (e) {
      // A refusal comes back 422 WITH the report in it — that's the useful
      // case, not an error to swallow.
      const body = e instanceof ApiError ? (e.body as RestoreReportDTO | null) : null;
      if (body && Array.isArray(body.errors)) setReport(body);
      else setError("Couldn't check that backup.");
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!doc) return;
    setBusy("restore");
    setError(null);
    try {
      const r = await api.restoreBackup(doc);
      setDone(r);
      setReport(null);
      setDoc(null);
      setTyped("");
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as RestoreReportDTO | null) : null;
      if (body && Array.isArray(body.errors) && body.errors.length) setReport(body);
      else setError("The restore didn't run.");
    } finally {
      setBusy(null);
    }
  };

  const blocked = !!report?.errors.length;
  const canRestore = !!report && !blocked && typed.trim().toUpperCase() === RESTORE_CONFIRM;

  return (
    <div>
      <SectLabel>Download a backup</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        <div className="sd-meta" style={{ lineHeight: 1.45 }}>
          One JSON file holding every table: people, households, contacts, the calendar,
          volunteer sheets, the newsletter, the store and the PTO boards.
        </div>
        <div className="sd-meta" style={{ lineHeight: 1.45, marginTop: 8 }}>
          It is the directory itself, not a filtered view — home addresses, private
          contact details and map coordinates are all in it. Keep it somewhere you'd
          keep the school's own records. Sessions, sign-in links and pending invitations
          are left out on purpose, and photos live in storage rather than the database,
          so they aren't in the file either.
        </div>
        <Btn icon="download" style={{ marginTop: 12 }} disabled={busy !== null} onClick={() => void download()}>
          {busy === "download" ? "Preparing…" : "Download backup"}
        </Btn>
      </div>

      <SectLabel>Restore from a backup</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        <div className="sd-meta" style={{ lineHeight: 1.45 }}>
          This replaces what's in the directory now with what's in the file. There is no
          undo. Pick a file to see exactly what it would write before anything happens.
        </div>
        <label className="sd-btn sd-btn-secondary" style={{ marginTop: 12, display: "inline-flex", cursor: "pointer" }}>
          <Icon name="upload" size={18} />
          <span style={{ marginLeft: 6 }}>{fileName || "Choose a backup file"}</span>
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </label>

        {busy === "preview" && <div className="sd-meta" style={{ marginTop: 10 }}>Checking that file…</div>}

        {report && (
          <div style={{ marginTop: 12 }}>
            {report.errors.map((msg) => (
              <div key={msg} className="sd-meta" style={{ color: "var(--warn)", lineHeight: 1.45, marginBottom: 6 }}>
                {msg}
              </div>
            ))}
            {!blocked && (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                  {report.totalRows} rows across {report.tables.filter((t) => !t.skipped).length} tables
                </div>
                <div className="sd-meta sd-mono" style={{ marginTop: 6, lineHeight: 1.6, fontSize: 11.5 }}>
                  {report.tables.map((t) => (
                    <div key={t.table}>
                      {t.table} · {t.rows}
                      {t.skipped ? " · kept as-is" : ""}
                    </div>
                  ))}
                </div>
                {report.warnings.map((msg) => (
                  <div key={msg} className="sd-meta" style={{ marginTop: 8, lineHeight: 1.45 }}>{msg}</div>
                ))}
                <div className="sd-meta" style={{ marginTop: 12 }}>
                  Type <strong>{RESTORE_CONFIRM}</strong> to confirm.
                </div>
                <input
                  className="sd-input"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={RESTORE_CONFIRM}
                  style={{ marginTop: 6, maxWidth: 200 }}
                />
                <Btn
                  kind="orange"
                  icon="upload"
                  style={{ marginTop: 12 }}
                  disabled={!canRestore || busy !== null}
                  onClick={() => void restore()}
                >
                  {busy === "restore" ? "Restoring…" : "Replace the directory"}
                </Btn>
              </>
            )}
          </div>
        )}

        {done && (
          <div className="sd-meta" style={{ marginTop: 12, lineHeight: 1.45 }}>
            Restored {done.rowsWritten ?? done.totalRows} rows. Everyone's sessions are
            still live, so anyone signed in is now looking at the restored data.
          </div>
        )}
        {error && <div className="sd-meta" style={{ marginTop: 10, color: "var(--warn)" }}>{error}</div>}
      </div>
    </div>
  );
}

export function Admin() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { me, refresh } = useSession();

  const [users, setUsers] = useState<AdminUserDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<AuditEntryDTO[]>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [actions, setActions] = useState<AuditActionCountDTO[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const auditReq = useRef(0);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  // `?tab=access` so the notification email can link straight at the queue.
  const [tab, setTab] = useState<"users" | "access" | "audit" | "backup">(() =>
    new URLSearchParams(window.location.search).get("tab") === "access" ? "access" : "users",
  );
  const [impactFor, setImpactFor] = useState<AdminUserDTO | null>(null);

  const loadUsers = () => void api.adminUsers().then((r) => setUsers(r.users)).catch(() => setUsers([]));
  useEffect(() => {
    loadUsers();
    void api.getRegistration().then((r) => setRegOpen(r.open)).catch(() => setRegOpen(null));
  }, []);

  // The action list is the log's own vocabulary, read once when the tab opens.
  useEffect(() => {
    if (tab !== "audit") return;
    void api.auditActions().then((r) => setActions(r.actions)).catch(() => setActions([]));
  }, [tab]);

  // Debounced, and only the latest request may land — a slow response for
  // "mil" must not overwrite the one for "milo".
  useEffect(() => {
    const id = ++auditReq.current;
    setAuditLoading(true);
    const handle = setTimeout(() => {
      void api.auditLog({ action: filter || undefined, q: search.trim() || undefined })
        .then((r) => {
          if (id !== auditReq.current) return;
          setEntries(r.entries);
          setNextBefore(r.nextBefore);
        })
        .catch(() => { if (id === auditReq.current) { setEntries([]); setNextBefore(null); } })
        .finally(() => { if (id === auditReq.current) setAuditLoading(false); });
    }, search ? 250 : 0);
    return () => clearTimeout(handle);
  }, [filter, search]);

  if (me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  const masquerade = async (userId: string) => {
    setBusy(userId);
    try {
      await api.startMasquerade(userId);
      await refresh();
      navigate("/");
    } finally {
      setBusy(null);
    }
  };

  /** Grant or revoke system admin. Optimistic; reverts if the API says no. */
  const setAdmin = async (userId: string, next: boolean) => {
    setBusy(`role:${userId}`);
    setUsersError(null);
    setUsers((list) => list.map((u) => (u.id === userId ? { ...u, isSystemAdmin: next } : u)));
    try {
      const r = await api.setUserAdmin(userId, next);
      setUsers((list) => list.map((u) => (u.id === userId ? r.user : u)));
    } catch {
      setUsers((list) => list.map((u) => (u.id === userId ? { ...u, isSystemAdmin: !next } : u)));
      setUsersError(`Couldn't ${next ? "grant" : "remove"} admin for that account.`);
    } finally {
      setBusy(null);
    }
  };

  /** Reversible, and it touches only the account — see the API route. The list
   *  is refetched rather than patched in place because disabling also ends
   *  their sessions, and the row's other affordances change with it. */
  const setDisabled = async (userId: string, next: boolean) => {
    setBusy(`disable:${userId}`);
    setUsersError(null);
    try {
      await api.setUserDisabled(userId, next);
      loadUsers();
    } catch {
      setUsersError(`Couldn't ${next ? "disable" : "re-enable"} that account.`);
    } finally {
      setBusy(null);
    }
  };

  const toggleReg = async () => {
    if (regOpen === null) return;
    const next = !regOpen;
    setRegOpen(next);
    try {
      const r = await api.setRegistration(next);
      setRegOpen(r.open);
    } catch {
      setRegOpen(!next); // revert on failure
    }
  };

  const loadMore = async () => {
    if (!nextBefore) return;
    const id = auditReq.current;
    const r = await api.auditLog({ action: filter || undefined, q: search.trim() || undefined, before: nextBefore });
    if (id !== auditReq.current) return; // the search changed while this page loaded
    setEntries((e) => [...e, ...r.entries]);
    setNextBefore(r.nextBefore);
  };

  const tabs: [typeof tab, string][] = [["users", "Users"], ["access", "Access"], ["audit", "Audit log"], ["backup", "Backup"]];
  const tabBar = (
    <div className="sd-row" style={{ gap: 2, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          style={{
            padding: "9px 14px", border: 0, background: "none", font: "inherit", cursor: "pointer",
            fontSize: 13.5, fontWeight: 700, marginBottom: -1,
            color: tab === key ? "var(--blue)" : "var(--ink-3)",
            borderBottom: `2px solid ${tab === key ? "var(--blue)" : "transparent"}`,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const usersTab = (
    <>
      {/* Suite-wide counters — its own screen, like Import. */}
      <SectLabel>Across the suite</SectLabel>
      <div className="sd-card" style={{ marginTop: 9, marginBottom: 18, padding: 13, display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }} onClick={() => navigate("/admin/metrics")}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
          <Icon name="chart" size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>Metrics</div>
          <div className="sd-meta">Counts across every site: members, calendar, volunteers, newsletter, store, PTO, lost &amp; found.</div>
        </div>
        <Icon name="chevright" size={18} style={{ color: "var(--ink-3)" }} />
      </div>

      {/* Registration toggle */}
      <SectLabel>Sign-ups</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        <div className="sd-row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Open registration</div>
            <div className="sd-meta" style={{ marginTop: 2, lineHeight: 1.4 }}>
              {regOpen
                ? "Anyone with an unknown email can request a sign-in link."
                : "New sign-ups are closed. Admins can still invite."}
            </div>
          </div>
          <button
            className={`sd-toggle${regOpen ? " on" : ""}`}
            aria-pressed={!!regOpen}
            aria-label="Toggle registration"
            disabled={regOpen === null}
            onClick={() => void toggleReg()}
          />
        </div>
      </div>

      <NotificationsSection />

      {/* Bulk import */}
      <div style={{ marginTop: 18 }}>
        <SectLabel>Import</SectLabel>
        <div className="sd-card" style={{ marginTop: 9, padding: 13, display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }} onClick={() => navigate("/admin/import")}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
            <Icon name="table" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Bulk import (CSV)</div>
            <div className="sd-meta">Add members &amp; groups from a roster file, with a dry-run.</div>
          </div>
          <Icon name="chevright" size={18} style={{ color: "var(--ink-3)" }} />
        </div>
      </div>

      {/* Calendar admin — moved to the calendar app; linked so it stays findable. */}
      <div style={{ marginTop: 18 }}>
        <SectLabel>Calendar</SectLabel>
        <a
          className="sd-card"
          href={`${CALENDAR_APP_URL}/admin`}
          style={{ marginTop: 9, padding: 13, display: "flex", alignItems: "center", gap: 11, color: "inherit", textDecoration: "none" }}
        >
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
            <Icon name="calendar" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Calendar admin</div>
            <div className="sd-meta">Manage calendars, events &amp; imported ICS feeds on the calendar site.</div>
          </div>
          <Icon name="chevright" size={18} style={{ color: "var(--ink-3)" }} />
        </a>
      </div>

      {/* Newsletter admin — its own site, like the calendar. */}
      <div style={{ marginTop: 18 }}>
        <SectLabel>Newsletter</SectLabel>
        <a
          className="sd-card"
          href={`${NEWSLETTER_APP_URL}/admin`}
          style={{ marginTop: 9, padding: 13, display: "flex", alignItems: "center", gap: 11, color: "inherit", textDecoration: "none" }}
        >
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
            <Icon name="mail" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Newsletter</div>
            <div className="sd-meta">Write and send newsletters, and manage subscribers, on the newsletter site.</div>
          </div>
          <Icon name="chevright" size={18} style={{ color: "var(--ink-3)" }} />
        </a>
      </div>

      {/* Users + masquerade */}
      <div style={{ marginTop: 18 }}>
        <SectLabel>Members &amp; sign-in accounts</SectLabel>
        <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
          {users.map((u) => {
            const isSelf = u.id === me?.user.id;
            return (
              <div key={u.id} className="sd-mrow">
                <Avatar name={u.email} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sd-row" style={{ gap: 7, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
                    {u.isSystemAdmin && <Tag tone="line"><Icon name="shield" size={11} stroke={2} />Admin</Tag>}
                    {isSelf && <Tag tone="blue">You</Tag>}
                    {u.disabled && <Tag tone="orange">Disabled</Tag>}
                  </div>
                  <div className="sd-meta">
                    {u.personCount} {u.personCount === 1 ? "person" : "people"}
                    {u.disabled && " · can't sign in; nothing of theirs was removed"}
                  </div>
                </div>
                {/* Icon-only, and deliberately so: four labelled buttons ran to
                    most of the row's width and squeezed the email — the one
                    thing that identifies the row — down to a few characters.
                    Every action here is reversible, and each says what it does
                    on hover and to a screen reader. */}
                {!isSelf && (
                  <div className="sd-row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flex: "0 0 auto" }}>
                    {/* A disabled account can't be acted on until it's back —
                        masquerading as one is already refused server-side, and
                        changing the role of someone who can't sign in is noise. */}
                    {!u.disabled && (
                      <>
                        <IconBtn
                          name="shield"
                          label={u.isSystemAdmin ? "Remove admin" : "Make admin"}
                          title={
                            u.isSystemAdmin
                              ? "Remove admin access. They keep their profile and the people they manage."
                              : "Give this account the full console: this list, masquerade, import and the audit log."
                          }
                          disabled={busy === `role:${u.id}`}
                          onClick={() => void setAdmin(u.id, !u.isSystemAdmin)}
                        />
                        <IconBtn
                          name="eye"
                          label="Masquerade"
                          title="See the directory as this account sees it. Starting and stopping is audited."
                          disabled={busy === u.id}
                          onClick={() => void masquerade(u.id)}
                        />
                      </>
                    )}
                    <IconBtn
                      name="info"
                      label="Review or delete account"
                      title={
                        u.disabled
                          ? "Review what deleting this account removes, then permanently delete it. Looking deletes nothing."
                          : "Show what deleting this account would remove. Disable it first to delete; looking deletes nothing."
                      }
                      onClick={() => setImpactFor(u)}
                    />
                    <IconBtn
                      name={u.disabled ? "check" : "lock"}
                      label={u.disabled ? "Re-enable" : "Disable"}
                      title={
                        u.disabled
                          ? "Let this account sign in again."
                          : "Sign them out and stop this account signing in. Reversible, and nothing of theirs is removed."
                      }
                      disabled={busy === `disable:${u.id}`}
                      onClick={() => void setDisabled(u.id, !u.disabled)}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {users.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>No users.</div>}
          {usersError && <div className="sd-meta" style={{ padding: "4px 0", color: "var(--warn)" }}>{usersError}</div>}
          <div className="sd-meta" style={{ padding: "8px 0 4px", lineHeight: 1.4 }}>
            Admins get the full console — this list, masquerade, import, and the audit log.
            You can't change your own role; ask another admin.
          </div>
          <CreateUserForm onCreated={loadUsers} />
        </div>
      </div>

      {impactFor && (
        <DeletionImpactSheet
          user={impactFor}
          onClose={() => setImpactFor(null)}
          onDeleted={() => { setImpactFor(null); loadUsers(); }}
        />
      )}
    </>
  );

  const auditTab = (
    <div>
      <SectLabel
          action={
            <select className="sd-input" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ height: 30, width: "auto", maxWidth: 220, fontSize: 12.5, padding: "0 8px" }}>
              <option value="">All actions</option>
              {filter && !actions.some((a) => a.action === filter) && <option value={filter}>{filter}</option>}
              {actions.map((a) => <option key={a.action} value={a.action}>{a.action} ({a.count})</option>)}
            </select>
          }
        >
          Audit log
        </SectLabel>
        <div style={{ position: "relative", marginTop: 9 }}>
          <Icon name="search" size={17} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
          <input
            className="sd-input"
            type="search"
            aria-label="Search the audit log"
            placeholder="Search email, action, id, IP or details"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 38 }}
          />
        </div>
        <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
          {entries.map((e) => (
            <div key={e.id} className="sd-crow" style={{ alignItems: "center" }}>
              <div className="sd-cicon"><Icon name={iconForAction(e.action)} size={16} /></div>
              <div className="sd-cmain">
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{e.action}</div>
                <div className="sd-meta" style={{ marginTop: 1 }}>
                  {e.actorEmail ?? "system"}
                  {e.masqueradingAsEmail ? ` (as ${e.masqueradingAsEmail})` : ""}
                  {e.entityKind ? ` · ${e.entityKind}` : ""}
                  {e.entityId ? <span className="sd-mono" style={{ fontSize: 11 }}>{` ${e.entityId}`}</span> : null}
                  {e.ip ? ` · ${e.ip}` : ""}
                </div>
                {e.detail && (
                  <div className="sd-meta sd-mono" style={{ marginTop: 2, fontSize: 11, overflowWrap: "anywhere" }}>{detailLine(e.detail)}</div>
                )}
              </div>
              <div className="sd-meta sd-mono" style={{ flex: "0 0 auto", fontSize: 11 }}>{fmtTime(e.createdAt)}</div>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="sd-meta" style={{ padding: "12px 0" }}>
              {auditLoading ? "Searching…" : search.trim() || filter ? "Nothing matches." : "No entries."}
            </div>
          )}
          {nextBefore && (
            <button className="sd-btn sd-btn-ghost sd-btn-sm block" style={{ marginTop: 8 }} onClick={() => void loadMore()}>Load more</button>
          )}
        </div>
        <div className="sd-row" style={{ gap: 8, marginTop: 12, padding: "11px 14px", background: "var(--bg-2)", borderRadius: 12, color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.4 }}>
          <Icon name="info" size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
          The audit log is append-only and hash-chained. Masquerade actions show the admin and the member they acted as.
        </div>
    </div>
  );

  const body = (
    <>
      {tabBar}
      {tab === "users" && usersTab}
      {tab === "access" && <AccessTab />}
      {tab === "audit" && auditTab}
      {tab === "backup" && <BackupTab />}
    </>
  );

  if (isDesktop) {
    return <DesktopShell active="admin" title="Admin"><div style={{ maxWidth: 720 }}>{body}</div></DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Admin" onLeft={() => navigate("/")} />
      <div className="sd-scroll"><div className="sd-body">{body}</div></div>
    </AppShell>
  );
}

function iconForAction(action: string): import("../components/Icon.js").IconName {
  if (action.startsWith("masquerade")) return "shield";
  if (action.startsWith("share")) return "lock";
  if (action.startsWith("auth")) return "check";
  if (action.startsWith("contact")) return "phone";
  if (action.startsWith("invite")) return "mail";
  if (action.startsWith("registration")) return "gear";
  if (action.startsWith("notify")) return "mail";
  return "bolt";
}


/**
 * The directory-access queue (migration 0029, invariant 32).
 *
 * The screen exists to show a reviewer the one thing an email address could
 * never tell them: who the applicant says they are, which children they
 * entered, and which ROOMS those children are claimed to be in. The room names
 * are the district's own, so one that does not exist reads as one that does not
 * exist.
 *
 * Three lists, because they are three jobs. "Waiting" is the work. "Decided" is
 * the record — worth keeping visible, since approving is reversible and a
 * decline that was wrong should be easy to find again. "Never asked" is the
 * population this gate exists to catch: accounts that signed up, entered nobody
 * and stopped.
 *
 * Declining is deliberately the quieter button. A wrongly declined family is a
 * worse outcome than a slow approval, and the copy on their side says so.
 *
 * English, like the rest of this file — admin chrome is operator tooling and is
 * exempt from invariant 6 by the decision recorded at the top. The FAMILY's
 * side of this feature (`screens/Access.tsx`) goes through the dictionaries in
 * all four languages, which is where the rule actually bites. Don't add
 * dictionary keys for the strings below; an earlier draft did, and thirteen of
 * them sat unused in four locales.
 */
function AccessTab() {
  const [state, setState] = useState<"pending" | "decided" | "never">("pending");
  const [rows, setRows] = useState<AccessRequestDTO[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = (s: typeof state) => {
    setRows(null);
    void api.accessRequests(s).then((r) => setRows(r.requests)).catch(() => setRows([]));
  };
  useEffect(() => { load(state); }, [state]);

  const decide = async (userId: string, approve: boolean) => {
    setBusy(userId);
    try {
      const r = await api.decideAccess(userId, approve);
      setNote(
        approve
          ? `Approved${r.promoted ? ` — ${r.promoted} classroom placement${r.promoted === 1 ? "" : "s"} confirmed` : ""}.`
          : "Declined. They can correct their details and ask again.",
      );
      load(state);
    } catch {
      setNote("That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="sd-row" style={{ gap: 6, marginBottom: 12 }}>
        {([["pending", "Waiting"], ["decided", "Decided"], ["never", "Never asked"]] as const).map(
          ([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setState(key)}
              className={`sd-btn sd-btn-sm ${state === key ? "sd-btn-primary" : "sd-btn-ghost"}`}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {state === "never" && (
        <div className="sd-row" style={{ gap: 8, marginBottom: 12, padding: "11px 14px", background: "var(--bg-2)", borderRadius: 12, color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.4 }}>
          <Icon name="info" size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
          These accounts signed up and never entered a family. They cannot see the directory.
        </div>
      )}

      {note && (
        <div className="sd-card sd-card-pad" style={{ marginBottom: 12, fontSize: 13.5 }}>{note}</div>
      )}

      {rows === null && <div className="sd-meta">Loading…</div>}
      {rows?.length === 0 && <div className="sd-meta">Nothing here right now.</div>}

      {rows?.map((r) => (
        <div key={r.userId} className="sd-card sd-card-pad" style={{ marginBottom: 10 }}>
          <div className="sd-row" style={{ gap: 8, alignItems: "baseline" }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{r.applicantName ?? "(no name entered)"}</div>
            {/* A teacher has no child to name, by design — without this the
                row below reads as a parent who forgot to enter their family. */}
            {r.roles.filter((x) => x === "teacher" || x === "staff").map((x) => (
              <Tag key={x} tone="line">{x === "teacher" ? "Teacher" : "Staff"}</Tag>
            ))}
          </div>
          <div className="sd-meta" style={{ marginTop: 2 }}>{r.email}</div>

          <div style={{ marginTop: 10 }}>
            {r.students.length === 0 && (
              <div className="sd-meta">
                {r.roles.some((x) => x === "teacher" || x === "staff")
                  ? "Works at the school — no children to list. Check the note below."
                  : "No children entered."}
              </div>
            )}
            {r.students.map((s) => (
              <div key={s.id} className="sd-row" style={{ gap: 8, padding: "3px 0", alignItems: "baseline" }}>
                <span style={{ fontSize: 13.5 }}>{s.name}</span>
                <span className="sd-meta" style={{ fontSize: 12.5 }}>
                  {s.classrooms.length ? s.classrooms.join(", ") : "no classroom chosen"}
                </span>
              </div>
            ))}
          </div>

          {r.note && (
            <div style={{ marginTop: 10, padding: "9px 12px", background: "var(--bg-2)", borderRadius: 10, fontSize: 13, lineHeight: 1.45 }}>
              {r.note}
            </div>
          )}

          <div className="sd-meta" style={{ marginTop: 10, fontSize: 12 }}>
            {r.submittedAt ? `Asked ${new Date(r.submittedAt).toLocaleDateString()}` : `Signed up ${new Date(r.createdAt).toLocaleDateString()}`}
            {r.state === "approved" && r.decidedBy ? ` · approved by ${r.decidedBy}` : ""}
            {r.state === "declined" && r.decidedBy ? ` · declined by ${r.decidedBy}` : ""}
          </div>

          <div className="sd-row" style={{ gap: 8, marginTop: 12 }}>
            {r.state !== "approved" && (
              <Btn kind="primary" icon="check" disabled={busy === r.userId} onClick={() => void decide(r.userId, true)}>
                Approve
              </Btn>
            )}
            {r.state !== "declined" && (
              <Btn kind="ghost" disabled={busy === r.userId} onClick={() => void decide(r.userId, false)}>
                Decline
              </Btn>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
