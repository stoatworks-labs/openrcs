// node plugins/console/lang.test.mjs — the grammar, with no device.
import assert from 'node:assert/strict';
import { parse, keywordTable, EXAMPLES } from './lang.js';

const p = (s) => { const r = parse(s); if (r.flags) r.flags = [...r.flags]; return r; };

assert.deepEqual(p('Take Screen 1').objects, { Screen: [1] });
assert.equal(p('ta sc 1').verb, 'Take');
assert.match(p('t sc 1').error, /could be/);
assert.deepEqual(p('R Sc 1 Me 5 Take'), { verb: 'Recall', objects: { Screen: [1], Memory: [5] }, mode: null, attrs: [], flags: ['Take'] });
assert.deepEqual(p('Select Screen 2 Layer 1 Thru 4').objects, { Screen: [2], Layer: [1, 2, 3, 4] });
assert.deepEqual(p('Layer 1 + 3').objects, { Layer: [1, 3] });
assert.deepEqual(p('Width 1080-80').attrs, [['Width', 1000]]);
assert.equal(p('Source 4').verb, 'Set');
assert.equal(p('Screen 1 Layer 2').verb, 'Select');
assert.equal(p('Go').verb, 'Go');
assert.deepEqual(p('Go Cue 7').objects, { Cue: [7] });
assert.match(p('S 1').error, /could be/);
assert.match(p('Take Screen').error, /needs a number/);
assert.match(p('Layer 3 Thru 1').error, /does not follow/);
assert.equal(p('!0,0,0PRinp').raw, '0,0,0PRinp');
assert.deepEqual(p('Group "Side PiPs" Source 2').objects, { Group: ['Side PiPs'] });
// Out is a flag, not the start of Output, when typed in full.
assert.deepEqual(p('Fade Screen 1 Out').flags, ['Out']);
for (const [cmd] of EXAMPLES) assert.ok(!parse(cmd).error, `${cmd}: ${parse(cmd).error}`);
const shorts = keywordTable();
assert.equal(new Set(shorts.map(k => k.short.toLowerCase())).size, shorts.length, 'short forms are unique');
console.log('lang ok');
