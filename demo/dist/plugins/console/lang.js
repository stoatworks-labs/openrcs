/*
 * The command language — words, short forms, and a parse into a plan.
 *
 * Modelled on the console LivePremier Plus borrowed from mynah: a verb, the
 * objects it acts on, a mode, and attributes, every keyword typable by its
 * shortest unambiguous prefix (`R Sc 1 Me 5` is `Recall Screen 1 Memory 5`).
 * The words are openrcs's, not mynah's — mynah speaks the LivePremier object
 * model, this speaks the LiveCore/Midra one — but an operator who knows one
 * reads the other.
 *
 * Pure: nothing here touches the device, so the whole grammar is testable
 * under plain Node (`node plugins/console/lang.test.mjs`).
 */

import { evaluate, looksLikeExpression, isPlainNumber } from '../arithmetic/expr.js';

export const KEYWORDS = [
  // verbs
  ['Take', 'verb'], ['Cut', 'verb'], ['Recall', 'verb'], ['Store', 'verb'], ['Select', 'verb'],
  ['Set', 'verb'], ['Clear', 'verb'], ['Go', 'verb'], ['Hold', 'verb'], ['Back', 'verb'],
  ['Fade', 'verb'], ['Freeze', 'verb'], ['Black', 'verb'], ['Lock', 'verb'], ['Unlock', 'verb'],
  ['Stepback', 'verb'], ['Help', 'verb'],
  // objects
  ['Screen', 'object'], ['Layer', 'object'], ['Master', 'object'], ['Memory', 'object'],
  ['Preset', 'object'], ['Input', 'object'], ['Output', 'object'], ['Cue', 'object'],
  ['Key', 'object'], ['Group', 'object'], ['All', 'object'],
  // modes
  ['Preview', 'mode'], ['Program', 'mode'],
  // attributes
  ['Source', 'attr'], ['Opacity', 'attr'], ['X', 'attr'], ['Y', 'attr'], ['Width', 'attr'],
  ['Height', 'attr'], ['Time', 'attr'],
  // clauses and flags
  ['Thru', 'clause'], ['+', 'clause'], ['In', 'flag'], ['Out', 'flag'], ['On', 'flag'], ['Off', 'flag'],
  ['Overwrite', 'flag'], ['Alone', 'flag'],
];
const WORDS = KEYWORDS.map(([w]) => w);

/** Each keyword with the shortest prefix no other keyword shares. */
export function keywordTable() {
  return KEYWORDS.map(([word, kind]) => {
    const lw = word.toLowerCase();
    let n = 1;
    while (n < lw.length && WORDS.some(o => o !== word && o.toLowerCase().startsWith(lw.slice(0, n)))) n++;
    return { word, kind, short: word.slice(0, n) };
  });
}

function matchWord(tok) {
  const t = tok.toLowerCase();
  const exact = WORDS.find(w => w.toLowerCase() === t);
  if (exact) return { word: exact };
  const hits = WORDS.filter(w => w.toLowerCase().startsWith(t));
  if (hits.length === 1) return { word: hits[0] };
  if (!hits.length) return { error: `“${tok}” is not a word here` };
  return { error: `“${tok}” could be ${hits.join(', ')} — type more of it` };
}

function num(tok) {
  if (isPlainNumber(tok)) return { value: Number(tok) };
  if (looksLikeExpression(tok)) {
    const r = evaluate(tok);
    return r.ok ? { value: r.value } : { error: `${tok}: ${r.error}` };
  }
  return null;
}

/**
 * Parse a line into { verb, objects, mode, attrs, flags } — or { error }.
 *
 * `objects` maps an object word to its list of numbers (`Screen 1 Thru 3` →
 * {Screen: [1, 2, 3]}); a quoted string after Group is its name. Numbers are
 * as typed (1-based); the caller turns them into indices.
 */
export function parse(line) {
  const text = String(line || '').trim();
  if (!text) return { error: 'empty' };
  if (text.startsWith('!')) return { verb: 'Raw', raw: text.slice(1).trim() };
  const toks = text.match(/"[^"]*"|\S+/g);
  const out = { verb: null, objects: {}, mode: null, attrs: [], flags: new Set() };
  let lastList = null;     // the list a Thru or + extends
  let pendingAttr = null;
  let pendingObj = null;
  let thru = false, plus = false;

  for (const tok of toks) {
    if (tok.startsWith('"')) {
      if (pendingObj === 'Group') { out.objects.Group = [tok.slice(1, -1)]; pendingObj = null; continue; }
      return { error: `a name in quotes only goes after Group` };
    }
    // A lone + is the list clause; `1+3` (no spaces) is arithmetic and makes 4.
    const n = tok === '+' ? null : num(tok);
    if (n?.error) return { error: n.error };
    if (n) {
      const v = n.value;
      if (pendingAttr) { out.attrs.push([pendingAttr, v]); pendingAttr = null; continue; }
      if (thru && lastList) {
        const from = lastList[lastList.length - 1];
        if (!Number.isInteger(v) || v < from) return { error: `Thru ${v} does not follow ${from}` };
        if (v - from > 200) return { error: 'that range is too long' };
        for (let k = from + 1; k <= v; k++) lastList.push(k);
        thru = false; continue;
      }
      if (plus && lastList) { lastList.push(v); plus = false; continue; }
      if (pendingObj) { out.objects[pendingObj] = [v]; lastList = out.objects[pendingObj]; pendingObj = null; continue; }
      return { error: `${tok} — a number, but for what?` };
    }
    const m = matchWord(tok);
    if (m.error) return { error: m.error };
    const kind = KEYWORDS.find(([w]) => w === m.word)[1];
    if (pendingAttr) return { error: `${pendingAttr} needs a number` };
    if (pendingObj && m.word !== 'All') return { error: `${pendingObj} needs a number` };
    if (kind === 'verb') {
      // "Recall Master 3 Take" — a trailing Take is the take flag, not a verb.
      if (out.verb && m.word === 'Take') { out.flags.add('Take'); continue; }
      if (out.verb) return { error: `two verbs: ${out.verb} and ${m.word}` };
      out.verb = m.word; continue;
    }
    if (kind === 'object') {
      if (m.word === 'All') { out.objects.All = true; pendingObj = null; continue; }
      pendingObj = m.word; continue;
    }
    if (kind === 'mode') { out.mode = m.word; continue; }
    if (kind === 'attr') { pendingAttr = m.word; continue; }
    if (kind === 'clause') { if (!lastList) return { error: `${m.word} needs a number before it` }; if (m.word === 'Thru') thru = true; else plus = true; continue; }
    if (kind === 'flag') { out.flags.add(m.word); continue; }
  }
  if (pendingAttr) return { error: `${pendingAttr} needs a number` };
  if (pendingObj && pendingObj !== 'Cue' && pendingObj !== 'Key') return { error: `${pendingObj} needs a number` };
  if (pendingObj) out.objects[pendingObj] = out.objects[pendingObj] || [];
  if (thru || plus) return { error: 'the line ends in the middle of a range' };
  // A line with no verb but attributes is a Set; `Key 3` alone runs the key;
  // any other objects alone, a Select.
  const objs = Object.keys(out.objects);
  if (!out.verb) out.verb = out.attrs.length ? 'Set' : objs.length === 1 && objs[0] === 'Key' ? 'Run' : objs.length ? 'Select' : null;
  if (!out.verb) return { error: 'nothing to do — start with a verb' };
  return out;
}

export const EXAMPLES = [
  ['Take Screen 1', 'Transition screen 1.'],
  ['Take Screen 1 Time 2.5', 'The same, as a 2.5 s T-bar sweep.'],
  ['Take', 'Take every screen.'],
  ['Recall Master 5', 'Load master memory 5 into preview.'],
  ['R Sc 1 Me 5 Take', 'Load screen 1’s memory 5 and put it on air.'],
  ['Store Screen 2 Memory 12', 'Save screen 2’s program into memory 12 (Overwrite to replace a used one).'],
  ['Select Screen 1 Layer 1 Thru 3', 'Put three layers under the next command.'],
  ['Source 4', 'Put input 4 on the selected layers, in preview.'],
  ['Width 1920/2 Height 1080/2', 'Size them — arithmetic works anywhere a number does.'],
  ['Sc 2 La 1 So 3 Program', 'Straight onto program, no selection.'],
  ['Take Screen 1 Layer 2 Alone', 'Take one layer; the rest stay (Layer Lock plugin).'],
  ['Clear Screen 1', 'Empty every layer of screen 1’s preview.'],
  ['Go', 'GO the next cue.  Go Cue 7 — a particular one.'],
  ['Key 3', 'Run key 3.'],
  ['Fade Screen 1 Out', 'Master fade to black.  In — back up.'],
  ['Freeze Input 3', 'Freeze an input.  Off — release it.'],
  ['!0,0,0PRinp', 'Anything after ! goes to the processor as typed.'],
];
