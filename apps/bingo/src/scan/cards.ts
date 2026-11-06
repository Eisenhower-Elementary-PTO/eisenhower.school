// Registered cards live in localStorage — each is the 25 printed numbers of
// one physical card, keyed by a player-chosen name. The numbers never change
// (they're printed), so registering is a once-per-card act; game nights are
// camera-only. Nothing here goes to the server: whose card is whose is not
// the directory's business.

export const FREE = 0; // center square sentinel

export interface SavedCard {
  id: string;
  name: string;
  /** Row-major 25 numbers; index 12 is FREE (0). */
  numbers: number[];
  createdAt: string;
}

const KEY = "sd_bingo_cards";

function load(): SavedCard[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is SavedCard =>
        typeof c === "object" && c !== null &&
        typeof (c as SavedCard).id === "string" &&
        typeof (c as SavedCard).name === "string" &&
        Array.isArray((c as SavedCard).numbers) &&
        (c as SavedCard).numbers.length === 25,
    );
  } catch {
    return [];
  }
}

function persist(cards: SavedCard[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards));
  } catch {
    // Private windows: registration won't survive a reload, scanning still works.
  }
}

export const cardStore = {
  all: (): SavedCard[] => load(),

  save(name: string, numbers: number[]): SavedCard {
    const cards = load();
    const card: SavedCard = {
      id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      name,
      numbers,
      createdAt: new Date().toISOString(),
    };
    cards.push(card);
    persist(cards);
    return card;
  },

  remove(id: string): void {
    persist(load().filter((c) => c.id !== id));
  },
};

/** The BINGO column range rule: column c holds 15c+1 .. 15c+15. */
export function validForColumn(value: number, col: number): boolean {
  return value >= col * 15 + 1 && value <= col * 15 + 15;
}

/** Validate a candidate 25-number grid; returns the offending indices. */
export function invalidCells(numbers: number[]): number[] {
  const bad: number[] = [];
  const seen = new Map<number, number>();
  for (let i = 0; i < 25; i++) {
    if (i === 12) continue;
    const value = numbers[i] ?? 0;
    const col = i % 5;
    if (!Number.isInteger(value) || !validForColumn(value, col)) {
      bad.push(i);
      continue;
    }
    const dup = seen.get(value);
    if (dup !== undefined) {
      bad.push(i);
      if (!bad.includes(dup)) bad.push(dup);
    } else {
      seen.set(value, i);
    }
  }
  return bad;
}
