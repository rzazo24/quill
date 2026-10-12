// The text of a long-form article (NIP-23) is Markdown. Quill reads it as text: headings, paragraphs, lists, quotes and code become blocks, and the
// inline marks (**bold**, _italic_, `code`) are dropped. A link keeps its words AND its whole address ("words (https://…)"), as every link in Quill
// does; a picture becomes its bare address, which the page then shows as a "Show image" button. Nothing here is ever treated as HTML.
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'item'; text: string; ordered: boolean }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'rule' }

/** The inline marks of one line, read as text. */
export function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g, ' $2 ') // a picture: its address, alone
    .replace(/\[([^\]]+)\]\((\S+?)(?:\s+"[^"]*")?\)/g, (_m, words: string, url: string) => (words.trim() === url.trim() ? url : `${words} (${url})`))
    .replace(/<((?:https?|nostr):[^>\s]+)>/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
}

export function markdownBlocks(md: string): Block[] {
  const out: Block[] = []
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  const flush = () => { if (para.length) { out.push({ type: 'paragraph', text: inline(para.join(' ').replace(/\s+/g, ' ').trim()) }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!, trimmed = line.trim()
    if (/^```/.test(trimmed)) { // a code block: kept as it is, up to the closing fence
      flush(); const code: string[] = []
      for (i++; i < lines.length && !/^```/.test(lines[i]!.trim()); i++) code.push(lines[i]!)
      out.push({ type: 'code', text: code.join('\n') }); continue
    }
    if (!trimmed) { flush(); continue }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed)
    if (h) { flush(); out.push({ type: 'heading', level: Math.min(3, h[1]!.length) as 1 | 2 | 3, text: inline(h[2]!) }); continue }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) { flush(); out.push({ type: 'rule' }); continue }
    const li = /^([-*+]|\d+[.)])\s+(.*)$/.exec(trimmed)
    if (li) { flush(); out.push({ type: 'item', text: inline(li[2]!), ordered: /\d/.test(li[1]!) }); continue }
    const q = /^>\s?(.*)$/.exec(trimmed)
    if (q) { flush(); const last = out[out.length - 1]; if (last?.type === 'quote') last.text += ' ' + inline(q[1]!); else out.push({ type: 'quote', text: inline(q[1]!) }); continue }
    para.push(trimmed)
  }
  flush()
  return out.filter((b) => b.type === 'rule' || b.type === 'code' || b.text.trim() !== '')
}
