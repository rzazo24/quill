// Building the page. There is no innerHTML anywhere in Quill: everything strangers wrote goes in as a text node.
export type Child = Node | string | null | false | undefined
type Props = Record<string, string | boolean | ((e: Event) => void) | undefined>

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v)
    else if (k === 'class') el.className = String(v)
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children) if (c) el.append(c)
  return el
}

/** Puts `kids` in `parent`, in that order, leaving in place the ones already there: a node that stays is not taken out and put back
 *  (taking it out loses its scroll, a text selection, a playing video). */
export function place(parent: Element, kids: Node[]): void {
  const keep = new Set(kids)
  for (const c of [...parent.childNodes]) if (!keep.has(c)) c.remove()
  let at = parent.firstChild
  for (const k of kids) { if (k === at) at = at.nextSibling; else parent.insertBefore(k, at) }
}

// the boxes that scroll, and the one that holds the columns: kept from one drawing to the next, only what is inside them changes
const shellKey = (el: Element): string | null =>
  el.matches('main.view') ? 'main' : el.matches('div.cols') ? 'cols' : el.matches('section.col[data-col]') ? `col:${el.getAttribute('data-col')}` : null

/** The old box takes the new one's attributes and contents; boxes inside it are kept the same way. Returns what goes on the page. */
export function adopt(old: Element | undefined, fresh: Element): Element {
  const key = shellKey(fresh)
  if (!old || !key || old.tagName !== fresh.tagName || shellKey(old) !== key) return fresh
  for (const a of [...old.attributes]) if (!fresh.hasAttribute(a.name)) old.removeAttribute(a.name)
  for (const a of [...fresh.attributes]) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value)
  const olds = new Map<string, Element>()
  for (const c of old.children) { const k = shellKey(c); if (k) olds.set(k, c) }
  place(old, [...fresh.childNodes].map((c) => (c instanceof Element && shellKey(c) ? adopt(olds.get(shellKey(c)!), c) : c)))
  return old
}

/** A note drawn again exactly as it was keeps its old node (its images already loaded, a menu or a fold as the reader left it). */
// notes already put on the page once: a list kept from before (a column that did not change) keeps its own nodes, nothing is swapped into it
const drawn = new WeakSet<Element>()
export function reuseNotes(from: Element, into: Element): void {
  const olds = new Map<string, HTMLElement[]>()
  for (const a of from.querySelectorAll<HTMLElement>('article.note[data-id]')) {
    if (into.contains(a)) continue // the same list drawn again: nothing to swap
    const id = a.dataset.id!
    olds.set(id, [...(olds.get(id) ?? []), a])
  }
  if (!olds.size) return
  const used = new Set<Element>()
  const inUsed = (n: Element) => { for (let p = n.parentElement; p; p = p.parentElement) if (used.has(p)) return true; return false }
  for (const n of [...into.querySelectorAll<HTMLElement>('article.note[data-id]')]) {
    if (drawn.has(n) || !into.contains(n) || inUsed(n)) continue
    const list = olds.get(n.dataset.id!) ?? []
    const i = list.findIndex((o) => !used.has(o) && !inUsed(o) && (o.classList.remove('here'), o.isEqualNode(n)))
    if (i < 0) continue
    const o = list[i]!
    used.add(o); n.replaceWith(o)
  }
}
export function markDrawn(page: Element): void { for (const a of page.querySelectorAll('article.note[data-id]')) drawn.add(a) }

/** Keys inside a small menu or panel: arrows (and Home/End) move between its buttons, Escape closes it and gives the focus back to `back`. */
export function menuKeys(box: Element, back: () => HTMLElement | null, close: () => void, grid = false): void {
  box.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent, items = [...box.querySelectorAll<HTMLElement>('button:not([hidden])')], i = items.indexOf(e.target as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); back()?.focus(); return }
    const step = e.key === 'ArrowDown' || (grid && e.key === 'ArrowRight') ? 1 : e.key === 'ArrowUp' || (grid && e.key === 'ArrowLeft') ? -1 : 0
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : step && i >= 0 ? (i + step + items.length) % items.length : -1
    if (to < 0 || !items.length) return
    e.preventDefault(); items[to]!.focus()
  })
}
