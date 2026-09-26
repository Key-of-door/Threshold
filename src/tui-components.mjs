import { matchesKey, isKeyRelease, wrapTextWithAnsi, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { readable } from './cli-format.mjs';

// All project/provider text is sanitized before entering the terminal renderer.
// `lead` and styled `right` parts are produced by Threshold's own formatters, never raw project text.
const clean = value => readable(value);
const part = value => !value ? null : typeof value === 'object' ? { ...value, text: clean(value.text), tone: value.tone ?? '' } : { text: clean(value), tone: 'dim' };
export const textBlock = (text, tone = '', options = {}) => ({ text: clean(text), tone, ...options });
export const action = (id, label, run, disabled = false, options = {}) => ({ id, label: clean(label).replace(/\s+/g, ' '), run, disabled, ...options });
export const actionRow = (...actions) => ({ actions });
export const item = (id, title, run, options = {}) => ({ kind: 'item', ...options, action: action(id, title, run, options.disabled),
  right: part(options.right), lines: (options.lines ?? []).map(part).filter(Boolean) });
export const section = (title, right) => ({ kind: 'section', title: clean(title), right: part(right) });
export const heading = (text, options = {}) => ({ kind: 'heading', text: clean(text), ...options, right: part(options.right) });
export const fields = (rows, options = {}) => ({ kind: 'fields', rows: rows.filter(Boolean).map(([label, value, tone = '']) => [clean(label), clean(value), tone]), ...options });
export const tabs = (actions, current) => ({ kind: 'tabs', actions, current });
export const bar = (left, right = []) => ({ kind: 'bar', left, right });
export const columns = (left, right, options = {}) => ({ kind: 'columns', left, right, rightWidth: 40, minWidth: 110, gap: 3, ...options });
export const gap = () => ({ kind: 'gap' });
export const rule = () => ({ kind: 'rule' });

const actionsOf = blocks => blocks.flatMap(b => b.kind === 'columns' ? [...actionsOf(b.left), ...actionsOf(b.right)]
  : b.kind === 'item' ? [b.action] : b.kind === 'bar' ? [...b.left, ...b.right].filter(p => p.run) : b.actions ?? []);
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - visibleWidth(text)));

export class DocumentView {
  constructor(style, invoke, options = {}) {
    this.style = style; this.invoke = invoke; this.glyphs = options.glyphs ?? { pointer: '>', rule: '-', crumb: ' > ', ellipsis: '...' };
    this.blocks = []; this.actions = []; this.hits = []; this.selected = null; this.focused = false; this.inert = false;
  }
  setBlocks(blocks) {
    this.blocks = blocks;
    this.actions = actionsOf(blocks).filter(a => !a.disabled);
    if (!this.actions.some(a => a.id === this.selected)) this.selected = this.actions[0]?.id ?? null;
  }
  has(id) { return this.actions.some(a => a.id === id); }
  render(width) {
    width = Math.max(1, width);
    const { lines, hits } = this.renderBlocks(this.blocks, width);
    this.hits = hits;
    return lines.length ? lines : [''];
  }
  renderBlocks(blocks, width) {
    const lines = [], hits = [], s = this.style;
    const wrap = (text, tone, w = width) => text.split('\n').flatMap(line => wrapTextWithAnsi(s(tone, line), Math.max(1, w)));
    const fit = (left, right) => {
      const rw = right ? visibleWidth(right) : 0;
      if (!rw) return wrapTextWithAnsi(left, width);
      if (visibleWidth(left) + 2 + rw <= width) return [pad(left, width - rw) + right];
      return [...wrapTextWithAnsi(left, width), ...wrapTextWithAnsi(right, width)];
    };
    const styled = p => p ? s(p.tone, p.text) : '';
    const selected = a => !a.disabled && a.id === this.selected && !this.inert;
    for (const b of blocks) {
      if (b.kind === 'gap') { lines.push(''); continue; }
      if (b.kind === 'rule') { lines.push(s('dim', this.glyphs.rule.repeat(width))); continue; }
      if (b.kind === 'section') {
        if (lines.length && lines.at(-1) !== '') lines.push('');
        lines.push(...fit(s('head', b.title), styled(b.right))); continue;
      }
      if (b.kind === 'heading') {
        const lead = b.lead ? b.lead + ' ' : '', right = styled(b.right), text = lead + s(b.tone ?? 'title', b.text);
        if (visibleWidth(text) + (right ? visibleWidth(right) + 2 : 0) <= width) lines.push(right ? pad(text, width - visibleWidth(right)) + right : text);
        else { lines.push(...wrapTextWithAnsi(text, width)); if (right) lines.push(...wrapTextWithAnsi(right, width)); }
        continue;
      }
      if (b.kind === 'fields') {
        const indent = ' '.repeat(b.indent ?? 0), inner = Math.max(1, width - indent.length);
        const labelWidth = Math.min(b.labelWidth ?? 18, Math.max(0, ...b.rows.map(([label]) => visibleWidth(label))));
        const stacked = inner < Math.max(30, labelWidth + 24);
        // clip: one-line preview; the full value stays reachable on the object's own page.
        const body = (value, tone, w) => !b.clip ? wrap(value, tone, w)
          : [truncateToWidth(s(tone, value.split('\n')[0] + (value.trim().includes('\n') ? ` ${this.glyphs.ellipsis}` : '')), Math.max(1, w), this.glyphs.ellipsis)];
        for (const [label, value, tone] of b.rows) {
          if (stacked || visibleWidth(label) > labelWidth) {
            lines.push(indent + truncateToWidth(s('dim', label), inner, this.glyphs.ellipsis));
            lines.push(...body(value, tone, inner - 2).map(l => indent + '  ' + l));
          } else body(value, tone, inner - labelWidth - 2)
            .forEach((l, i) => lines.push(indent + (i ? ' '.repeat(labelWidth + 2) : pad(s('dim', label), labelWidth) + '  ') + l));
        }
        continue;
      }
      if (b.kind === 'item') {
        const a = b.action, indent = ' '.repeat(b.indent ?? 0), on = selected(a);
        const pointer = on ? s(this.focused ? 'accent' : 'dim', this.glyphs.pointer) + ' ' : '  ';
        const lead = b.lead ? b.lead + ' ' : '', left = indent + pointer + lead;
        const labelTone = a.disabled ? 'dim' : on && this.focused ? 'focus' : b.value !== undefined ? '' : b.tone ?? 'strong';
        const title = b.value === undefined ? s(labelTone, a.label)
          : pad(s(labelTone, a.label), b.labelWidth ?? 0) + '  ' + s(b.valueTone ?? 'strong', clean(b.value).replace(/\s*\n\s*/g, ' / '));
        const right = styled(b.right);
        const y = lines.length, sub = indent + '    ', subWidth = Math.max(1, width - sub.length);
        // Titles win over metadata: when both do not fit, metadata moves to its own line.
        if (!right || visibleWidth(left + title) + 2 + visibleWidth(right) <= width) lines.push(right ? pad(left + title, width - visibleWidth(right)) + right : truncateToWidth(left + title, width, this.glyphs.ellipsis));
        else lines.push(truncateToWidth(left + title, width, this.glyphs.ellipsis), sub + truncateToWidth(right, subWidth, this.glyphs.ellipsis));
        hits.push({ x: indent.length, y, width: Math.max(1, width - indent.length), action: a });
        for (const l of b.lines) {
          if (l.clip) lines.push(sub + truncateToWidth(s(l.tone, l.text.split('\n')[0]), subWidth, this.glyphs.ellipsis));
          else lines.push(...wrap(l.text, l.tone, subWidth).map(x => sub + x));
        }
        continue;
      }
      if (b.kind === 'bar') {
        let row = '', used = 0; const y = lines.length, rowHits = [];
        const plain = p => p.run ? p.label : clean(p.text);
        const joined = parts => parts.map(plain).join(this.glyphs.crumb);
        const rightParts = width < 60 ? b.right.map(p => p.short ? { ...p, text: p.short } : p) : b.right;
        const right = rightParts.map(p => p.run ? s('accent', p.label) : s(p.tone ?? 'dim', clean(p.text))).join(s('dim', '  '));
        const room = Math.max(1, width - (right ? visibleWidth(right) + 2 : 0));
        // Keep the first and current location; collapse middle crumbs before truncating.
        let left = b.left;
        if (left.length > 2 && visibleWidth(joined(left)) > room) {
          const ell = { text: this.glyphs.ellipsis, tone: 'dim' }, first = left[0], last = left.at(-1), middle = left.slice(1, -1);
          const options = [...middle.map((_, k) => [first, ell, ...middle.slice(k + 1), last]), [last]];
          left = options.find(o => visibleWidth(joined(o)) <= room) ?? [last];
        }
        left.forEach((p, i) => {
          if (i) { row += s('dim', this.glyphs.crumb); used += visibleWidth(this.glyphs.crumb); }
          const text = p.run ? s(selected(p) && this.focused ? 'selected' : 'accent', p.label) : s(p.tone ?? '', clean(p.text));
          const size = visibleWidth(text);
          if (p.run && used < room) rowHits.push({ x: used, y, width: Math.min(size, room - used), action: p });
          row += text; used += size;
        });
        hits.push(...rowHits);
        lines.push(right ? pad(truncateToWidth(row, room, this.glyphs.ellipsis), width - visibleWidth(right)) + right : truncateToWidth(row, width, this.glyphs.ellipsis));
        continue;
      }
      if (b.kind === 'columns') {
        if (width < b.minWidth) {
          for (const side of [b.left, b.right]) {
            const r = this.renderBlocks(side, width);
            hits.push(...r.hits.map(h => ({ ...h, y: h.y + lines.length }))); lines.push(...r.lines);
          }
          continue;
        }
        const rw = Math.min(b.rightWidth, Math.floor(width / 2)), lw = width - rw - b.gap;
        const L = this.renderBlocks(b.left, lw), R = this.renderBlocks(b.right, rw), top = lines.length;
        hits.push(...L.hits.map(h => ({ ...h, y: h.y + top })), ...R.hits.map(h => ({ ...h, x: h.x + lw + b.gap, y: h.y + top })));
        for (let i = 0; i < Math.max(L.lines.length, R.lines.length); i++) lines.push((R.lines[i] ? pad(L.lines[i] ?? '', lw + b.gap) + R.lines[i] : L.lines[i] ?? ''));
        continue;
      }
      if (b.kind === 'tabs' || b.actions) {
        // Tabs reserve a leading cell for the no-color selection/current marker.
        let row = '', used = 0; const sep = b.kind === 'tabs' ? 2 : 1;
        for (const a of b.actions) {
          const label = truncateToWidth(b.kind === 'tabs' ? ` ${a.label}` : `[ ${a.label} ]`, width, '');
          const size = visibleWidth(label);
          if (used && used + size + sep > width) { lines.push(row); row = ''; used = 0; }
          if (used) { row += ' '.repeat(sep); used += sep; }
          hits.push({ x: used, y: lines.length, width: size, action: a });
          row += this.buttonStyle(a, label, b.kind === 'tabs' && a.id === b.current, b.kind === 'tabs');
          used += size;
        }
        if (row) lines.push(row);
        continue;
      }
      const indent = ' '.repeat(b.indent ?? 0);
      lines.push(...wrap(b.text, b.tone, width - indent.length).map(l => indent + l));
    }
    return { lines, hits };
  }
  buttonStyle(a, label, current, tab) {
    const s = this.style;
    if (a.disabled) return s('dim', label);
    if (!this.inert && this.focused && a.id === this.selected) return s('selected', label);
    if (tab) return s(current ? 'current' : '', label);
    if (!label.startsWith('[ ') || !label.endsWith(' ]')) return s(a.tone ?? 'accent', label);
    return s('dim', '[ ') + s(a.tone ?? 'accent', label.slice(2, -2)) + s('dim', ' ]');
  }
  handleMouse(event) {
    if (event.type !== 'click' || event.button !== 'left' || this.inert) return;
    const hit = this.hits.find(h => h.y === event.y && event.x >= h.x && event.x < h.x + h.width);
    if (!hit) return; // Let the renderer handle text selection/copy on prose.
    if (!hit.action.disabled) { this.selected = hit.action.id; this.onFocus?.(); this.invoke(hit.action.run); }
    return { handled: true, render: true };
  }
  handleInput(data) {
    if (isKeyRelease(data) || this.inert) return;
    if (matchesKey(data, 'enter')) { const a = this.actions.find(a => a.id === this.selected); if (a) this.invoke(a.run); return; }
    const step = matchesKey(data, 'shift+tab') || matchesKey(data, 'up') ? -1 : matchesKey(data, 'tab') || matchesKey(data, 'down') ? 1 : 0;
    if (!step || !this.actions.length) return;
    const index = this.actions.findIndex(a => a.id === this.selected), next = index + step;
    if ((next < 0 || next >= this.actions.length) && this.onBoundary?.(step)) return;
    this.selected = this.actions[(next + this.actions.length) % this.actions.length].id;
    this.onMove?.(this.hits.find(h => h.action.id === this.selected)?.y ?? 0);
  }
  invalidate() {}
}
