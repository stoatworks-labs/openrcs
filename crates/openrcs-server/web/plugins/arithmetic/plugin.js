/*
 * Field arithmetic — type `1080-80` in a layer width and get 1000.
 *
 * Ported from LivePremier Plus's plugin of the same name. There it has to get
 * in front of the vendor's React handlers; here the surface is ours, so the
 * shape is simpler and it covers more fields:
 *
 * - The host builds every numeric field as a text field marked `data-math`
 *   (`host.mathFields()`), because a `type=number` input throws the typed
 *   expression away before any script can read it.
 * - While a field holds an expression, its `input` events are stopped at the
 *   document, in the capture phase — a surface handler that writes on every
 *   keystroke must never see `1080-` and send the device 1080, then 0.
 * - Enter, Tab-away and `change` are the commits. The expression is evaluated
 *   (expr.js: a closed recursive-descent parser, no `eval`), fitted to the
 *   field's own min/max/step, written back, and an `input` and a `change` are
 *   dispatched so the field's own handler sends the number.
 * - Up and Down still step the value, as they did when the field was a
 *   number input.
 */

import { evaluate, fitToField, looksLikeExpression } from './expr.js';

const isMath = (t) => t && t.tagName === 'INPUT' && t.hasAttribute('data-math') && !t.disabled && !t.readOnly;

function limits(t) {
  const step = t.getAttribute('step');
  return { min: t.getAttribute('min'), max: t.getAttribute('max'), step: step === 'any' ? null : (step || '1') };
}

// Evaluate in place. True when the field now holds a different number.
function commit(t) {
  const raw = t.value;
  if (!looksLikeExpression(raw)) return false;
  const r = evaluate(raw);
  if (!r.ok) { t.classList.add('math-bad'); t.title = `Not worked out: ${r.error}`; return false; }
  t.value = String(fitToField(r.value, limits(t)));
  t.classList.remove('math-bad');
  t.title = `${raw.trim()} = ${t.value}`;
  t.classList.remove('math-applied'); void t.offsetWidth; t.classList.add('math-applied');
  return true;
}
const fire = (t) => { t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); };

export default {
  id: 'arithmetic',
  name: 'Field arithmetic',
  description: 'Type 1080-80 in a layer width and get 1000. Every numeric field takes + − × ÷ and brackets, and Up/Down still step.',
  setup(host) {
    host.mathFields(true);
    host.css(`
      @keyframes math-flash { from { background-color: rgba(34,184,207,.45); } to { background-color: transparent; } }
      input[data-math].math-applied { animation: math-flash 900ms ease-out; }
      input[data-math].math-bad { outline: 1px solid var(--pgm); }
    `);
    // Stop half-typed expressions reaching the field's own handler.
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (isMath(t) && e.isTrusted && looksLikeExpression(t.value)) e.stopPropagation();
      else if (isMath(t)) t.classList.remove('math-bad');
    }, true);
    // A native change (blur after typing) carries the expression: swap in the
    // number and let the event go on, then tell the input handlers too.
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (isMath(t) && e.isTrusted && commit(t)) t.dispatchEvent(new Event('input', { bubbles: true }));
    }, true);
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!isMath(t)) return;
      if (e.key === 'Enter') { if (commit(t)) fire(t); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const cur = Number(t.value);
      if (!Number.isFinite(cur)) return;
      const { min, max, step } = limits(t);
      const by = Number(step) || 1;
      t.value = String(fitToField(cur + (e.key === 'ArrowUp' ? by : -by) * (e.shiftKey ? 10 : 1), { min, max, step }));
      e.preventDefault();
      fire(t);
    }, true);
  },
};
