// What the claim form remembers on THIS device, for families without an
// account: the same school loses the same child's things all year, and
// retyping a name, contact, child and teacher on a phone is where typos come
// from — a mistyped contact is a notification that never arrives.
//
// localStorage, this origin only, written after a SUCCESSFUL submit and only
// when nobody is signed in (a signed-in member's claim prefills from their
// session instead, and a shared family device shouldn't offer one parent's
// details under the other's account). It is a per-device convenience, never
// state: every read and write is wrapped, and the form simply starts empty in
// a private window or with site data cleared. `rememberedEmail.ts` is the
// sibling pattern for the sign-in form.

const KEY = "lf_claim_defaults";

export interface ClaimDefaults {
  name: string;
  contact: string;
  childName: string;
  teacher: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function loadClaimDefaults(): ClaimDefaults {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { name: "", contact: "", childName: "", teacher: "" };
    const v: unknown = JSON.parse(raw);
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return { name: str(o.name), contact: str(o.contact), childName: str(o.childName), teacher: str(o.teacher) };
  } catch {
    return { name: "", contact: "", childName: "", teacher: "" };
  }
}

export function saveClaimDefaults(d: ClaimDefaults): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Storage refused (private window, quota): the next claim starts empty.
  }
}
