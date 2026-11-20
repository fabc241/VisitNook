// Text normalization shared by every guardrail check. Pure functions, no React Native imports.

const SMALL: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** Unit words → the short form, so "500 milligrams" and "500mg" compare equal. */
const UNIT_WORDS: Record<string, string> = {
  milligram: 'mg',
  milligrams: 'mg',
  mgs: 'mg',
  microgram: 'mcg',
  micrograms: 'mcg',
  mcgs: 'mcg',
  ug: 'mcg',
  gram: 'g',
  grams: 'g',
  gm: 'g',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  mls: 'ml',
  cc: 'ml',
  unit: 'units',
};

const DECIMAL_MARK = '\u0001';

function isNumberWord(word: string): boolean {
  return word in SMALL || word in TENS || word === 'hundred' || word === 'thousand';
}

/**
 * Replaces runs of number words with digits: "two" → "2", "twenty five" →
 * "25", "five hundred" → "500", "one hundred and fifty" → "150". A run is
 * cut where the words cannot belong to one number ("one two" → "1 2").
 */
function wordsToDigits(tokens: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  let current = 0;
  let inRun = false;

  const flush = () => {
    if (inRun) out.push(String(total + current));
    total = 0;
    current = 0;
    inRun = false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    // "and" only joins two number words ("one hundred and fifty").
    if (word === 'and' && inRun && current % 100 === 0 && current > 0 && isNumberWord(tokens[i + 1] ?? '')) {
      continue;
    }
    if (!isNumberWord(word)) {
      flush();
      out.push(word);
      continue;
    }
    const lastTwo = current % 100;
    if (word in SMALL) {
      const v = SMALL[word];
      const fits = v < 10 ? lastTwo === 0 || (lastTwo >= 20 && lastTwo % 10 === 0) : lastTwo === 0;
      if (inRun && !fits) flush();
      current += v;
    } else if (word in TENS) {
      if (inRun && lastTwo !== 0) flush();
      current += TENS[word];
    } else if (word === 'hundred') {
      if (inRun && current >= 100) flush();
      current = (current || 1) * 100;
    } else {
      total += (current || 1) * 1000;
      current = 0;
    }
    inRun = true;
  }
  flush();
  return out;
}

/**
 * Lowercase word tokens with punctuation removed, number words turned into
 * digits and unit words shortened. Decimals ("0.5") are kept whole; digits
 * and letters are split apart ("500mg" → "500 mg").
 */
export function tokenize(text: string): string[] {
  let s = text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/%/g, ' percent ')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/(\d)\.(\d)/g, `$1${DECIMAL_MARK}$2`)
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9\u0001]+/g, ' ')
    .replace(/\u0001/g, '.')
    .replace(/\bper cent\b/g, 'percent')
    .replace(/\binternational units?\b/g, 'iu')
    .trim();
  if (!s) return [];
  s = s.replace(/\s+/g, ' ');
  return wordsToDigits(s.split(' ')).map((t) => UNIT_WORDS[t] ?? t);
}

/** The normalized text as one string, tokens joined by single spaces. */
export function normalize(text: string): string {
  return tokenize(text).join(' ');
}

/** A rough singular: drops a final "s" (not "ss") so "antibiotics" matches "antibiotic". */
export function stem(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') && !/\d/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

export function stemmedTokens(text: string): string[] {
  return tokenize(text).map(stem);
}

/** Edit distance between two short words; stops early once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}
