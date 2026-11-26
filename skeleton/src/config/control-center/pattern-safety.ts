// Copied verbatim from ownera-apps packages/backend/src/services/AdapterConfig/patternSafety.ts
// (branch feature/demo, commit 4ecad8aef): Control Center's own check of a manifest pattern.
// The skeleton runs it while deriving the manifest, so a pattern Control Center would refuse is left
// to the adapter instead of making Control Center refuse the whole manifest. Keep it in step with
// that file; it is the authority.
/* eslint-disable */

/**
 * Whether a manifest's `pattern` is safe to run on the event loop. A pattern runs synchronously on every string the
 * relay checks (up to 4096 characters), so one that backtracks exponentially, such as `^(a+)+$` on a long input,
 * would stall every request of this backend. JavaScript can't stop a running regex, so risky shapes are refused when
 * the manifest is checked instead:
 * - a group that can match in more than one way (an alternation, or a quantifier that varies: `*`, `+`, `?`,
 *   `{n,m}`) and is itself repeated more than once, a fixed number of times included: `(a+)+`, `(a|ab)*`,
 *   `(a|aa){100}`, `(.*a){10}`. A group that is optional (`(\S+)?`) or holds only fixed counts (`(\d{3}){2}`) is fine;
 * - backreferences and lookarounds;
 * - quantifiers and alternations that, together, give too many ways to match: each quantifier that varies multiplies
 *   the paths a failing match can try (`*`, `+` and `{n,}` by the longest string, `{n,m}` by its range, `?` by two), so
 *   does each alternation (by its number of alternatives: thirty `(a|aa)` in a row ran for minutes, so alternations also
 *   have their own, far lower `MAX_ALTERNATION_PATHS`), and the product must
 *   stay within `MAX_MATCH_PATHS`, about the longest string squared. Two `*` pass; six `a{0,16}` don't. A pattern
 *   matches anywhere in the string, so one not anchored with `^` (or with a top-level `|`, whose other side isn't)
 *   is also tried from every start: that counts as one more unbounded quantifier. Unanchored, `.*a.*b` ran 35 s.
 * Conservative on purpose: it refuses some patterns that would run fine. An adapter can always check a value in its
 * own operation instead.
 */
/** The longest string a schema may allow (`schema.ts` `MAX_STRING_LENGTH`): an unbounded quantifier can repeat this often. */
const LONGEST_STRING = 4096;
/** How many ways to match a pattern may have, about the longest string squared: the worst case takes tens of ms. */
const MAX_MATCH_PATHS = (LONGEST_STRING + 1) ** 2;
/** Alternation paths cost far more each (twenty `(a|aa)` in a row took 39 ms on 60 characters), so their own product stays far lower. */
const MAX_ALTERNATION_PATHS = 2 ** 16;

interface Quantifier {
  length: number;
  /** Its atom can appear more than once. */
  repeats: boolean;
  /** How many times its atom appears isn't fixed. */
  varies: boolean;
  /** How many more ways it gives a match to try: its range plus one, the longest string for an unbounded one. */
  paths: number;
}

const quantifierAt = (pattern: string, index: number): Quantifier | undefined => {
  const char = pattern[index];
  let quantifier: Quantifier | undefined;
  if (char === '*' || char === '+') quantifier = { length: 1, repeats: true, varies: true, paths: LONGEST_STRING + 1 };
  else if (char === '?') quantifier = { length: 1, repeats: false, varies: true, paths: 2 };
  else if (char === '{') {
    const match = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(index));
    if (!match) return undefined;
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3]);
    quantifier = {
      length: match[0].length,
      repeats: max > 1,
      varies: max > min,
      // At least 1: a count above the longest string can't repeat more often than the string is long (a 0 or negative
      // factor would switch the whole bound off).
      paths: Math.max(1, Math.min(max, LONGEST_STRING) - Math.min(min, LONGEST_STRING) + 1),
    };
  }
  if (!quantifier) return undefined;
  // A lazy quantifier (`+?`) backtracks the same way.
  return pattern[index + quantifier.length] === '?' ? { ...quantifier, length: quantifier.length + 1 } : quantifier;
};

export function isSafePattern(pattern: string): boolean {
  // Each open group: whether it can match in more than one way (an alternation, or a quantifier that varies), and its
  // number of alternatives.
  const groups: { risky: boolean; alternatives: number }[] = [];
  let topAlternatives = 1;
  let alternationPaths = 1;
  const markParentRisky = () => {
    if (groups.length) groups[groups.length - 1].risky = true;
  };
  let paths = 1;
  // Not anchored at the start, the engine tries the pattern from every position of the string.
  let anchored = pattern.startsWith('^');
  if (!anchored) paths *= LONGEST_STRING + 1;

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '\\') {
      const next = pattern[i + 1];
      if (next === undefined || /[1-9k]/.test(next)) return false; // a backreference, or a dangling escape
      i += 1;
      if ('upP'.includes(next) && pattern[i + 1] === '{') {
        const end = pattern.indexOf('}', i);
        if (end < 0) return false;
        i = end;
      }
      continue;
    }
    if (char === '[') {
      i += 1;
      if (pattern[i] === '^') i += 1;
      if (pattern[i] === ']') i += 1;
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
      if (i >= pattern.length) return false;
      continue;
    }
    if (char === '(') {
      if (pattern[i + 1] === '?') {
        if (pattern[i + 2] === ':') i += 2;
        else if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
          const end = pattern.indexOf('>', i);
          if (end < 0) return false;
          i = end;
        } else return false; // a lookaround, or a group syntax this check doesn't know
      }
      groups.push({ risky: false, alternatives: 1 });
      continue;
    }
    if (char === ')') {
      const group = groups.pop();
      if (!group) return false;
      paths *= group.alternatives;
      alternationPaths *= group.alternatives;
      if (paths > MAX_MATCH_PATHS || alternationPaths > MAX_ALTERNATION_PATHS) return false;
      const quantifier = quantifierAt(pattern, i + 1);
      if (quantifier) {
        if (quantifier.repeats && group.risky) return false;
        paths *= quantifier.paths;
        if (paths > MAX_MATCH_PATHS) return false;
        i += quantifier.length;
        if (quantifier.varies || group.risky) markParentRisky();
      } else if (group.risky) {
        markParentRisky();
      }
      continue;
    }
    if (char === '|') {
      if (groups.length) groups[groups.length - 1].alternatives += 1;
      else topAlternatives += 1;
      if (groups.length === 0 && anchored) {
        // The other side of a top-level alternation isn't anchored by the leading `^`.
        anchored = false;
        paths *= LONGEST_STRING + 1;
        if (paths > MAX_MATCH_PATHS) return false;
      }
      markParentRisky();
      continue;
    }
    const quantifier = quantifierAt(pattern, i);
    if (quantifier) {
      paths *= quantifier.paths;
      if (paths > MAX_MATCH_PATHS) return false;
      if (quantifier.varies) markParentRisky();
      i += quantifier.length - 1;
    }
  }
  return (
    groups.length === 0 &&
    paths * topAlternatives <= MAX_MATCH_PATHS &&
    alternationPaths * topAlternatives <= MAX_ALTERNATION_PATHS
  );
}
