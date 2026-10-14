// A long-form article (NIP-23, kind 30023): replaceable, named by its author and its `d` identifier, so the newest version is the article.
import type { Event } from 'nostr-tools'
import { ARTICLE_KIND } from '../core/refs.js'
import { cleanText } from '../core/text.js'
import type { Fetcher } from '../net/fetcher.js'

/** `image`: the cover (an https address), or empty. */
export interface ArticleInfo { title: string; summary: string; publishedAt: number; image: string }
const tag = (e: Event, name: string): string | undefined => e.tags.find((t) => t[0] === name && typeof t[1] === 'string')?.[1]

export function articleInfo(e: Event): ArticleInfo {
  const published = Number(tag(e, 'published_at'))
  return { title: cleanText(tag(e, 'title') ?? '', 200).trim(), summary: cleanText(tag(e, 'summary') ?? '', 600).trim(), publishedAt: Number.isFinite(published) && published > 0 ? published : e.created_at, image: /^https:\/\/\S+$/.test(tag(e, 'image') ?? '') ? tag(e, 'image')! : '' }
}

/** The newest version of the article, asked of every relay (and of the relays its reference names), or null. */
export async function loadArticle(f: Fetcher, pubkey: string, identifier: string, hints: string[] = []): Promise<Event | null> {
  const found = (await f.query({ kinds: [ARTICLE_KIND], authors: [pubkey], '#d': [identifier], limit: 10 }, { quick: false, also: hints }))
    .filter((e) => e.kind === ARTICLE_KIND && e.pubkey === pubkey && tag(e, 'd') === identifier)
  return found.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0] ?? null
}
