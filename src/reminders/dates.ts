// Calendar dates said out loud: "the third of December", "December 3rd",
// "3 Dec". Pure TypeScript, unit-tested.

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};

const UNITS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];

/** "twenty first", "twenty-first", "thirty first" → 21, 21, 31; plain ordinals too. */
function ordinalWordValue(words: string): number | null {
  const w = words.replace(/-/g, ' ').trim();
  if (w in ORDINAL_WORDS) return ORDINAL_WORDS[w];
  const m = /^(twenty|thirty) (\w+)$/.exec(w);
  if (!m || !UNITS.includes(m[2])) return null;
  return (m[1] === 'twenty' ? 20 : 30) + ORDINAL_WORDS[m[2]];
}

const ORDINAL_WORD_RE =
  '(?:(?:twenty|thirty)[\\s-](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|' +
  Object.keys(ORDINAL_WORDS).join('|') +
  ')';
/** A day: "3", "3rd", "third", "twenty-first". */
const DAY_RE = `(\\d{1,2}(?:st|nd|rd|th)?|${ORDINAL_WORD_RE})(?![a-z0-9])`;
const MONTH_RE = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')})(?![a-z])\\.?`;

// "(the) 3rd of December", "3 December"
const DAY_MONTH = new RegExp(`\\b(?:the\\s+)?${DAY_RE}\\s+(?:of\\s+)?${MONTH_RE}`, 'g');
// "December 3rd", "December the third"
const MONTH_DAY = new RegExp(`\\b${MONTH_RE}\\s+(?:the\\s+)?${DAY_RE}\\b`, 'g');

function dayValue(token: string): number | null {
  const digits = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(token);
  if (digits) return Number(digits[1]);
  return ordinalWordValue(token);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export type SpokenDate = {
  /** Local `YYYY-MM-DD`: the first such day on or after `from`. */
  day: string;
  /** The words as said, e.g. "the third of December". */
  said: string;
};

/**
 * Every calendar date named in `text`, placed in the first year that puts it
 * on or after `from` (`YYYY-MM-DD`). Ambiguous words are skipped: "may" only
 * counts as a month next to a digit or after "of" ("you may first…" is not a date).
 */
export function datesIn(text: string, from: string): SpokenDate[] {
  const lower = text.toLowerCase();
  const [fromYear] = from.split('-').map(Number);
  const found = new Map<string, SpokenDate>();

  const add = (dayToken: string, monthToken: string, m: RegExpMatchArray, mayOk: boolean) => {
    const month = MONTHS[monthToken];
    const date = dayValue(dayToken);
    if (!month || !date) return;
    if (monthToken === 'may' && !mayOk) return;
    for (const year of [fromYear, fromYear + 1]) {
      if (date > daysInMonth(year, month)) continue;
      const day = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
      if (day < from) continue;
      const start = m.index ?? 0;
      if (!found.has(day)) found.set(day, { day, said: text.slice(start, start + m[0].length).trim() });
      return;
    }
  };

  for (const m of lower.matchAll(DAY_MONTH)) {
    add(m[1], m[2], m, /\bof\s+may\b/.test(m[0]) || /^\d/.test(m[1]));
  }
  for (const m of lower.matchAll(MONTH_DAY)) {
    add(m[2], m[1], m, /^\d/.test(m[2]));
  }
  return [...found.values()];
}
