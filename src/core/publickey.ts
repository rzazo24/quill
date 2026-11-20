// Some accounts publish their own private key on purpose (in the profile's name or bio), so that anyone can sign in and post as them: shared notice
// boards, bots, experiments. Nothing such an account publishes can be trusted to come from one person, and anything sent to it (zaps, private
// messages) can be taken or read by anyone. This only answers "does this profile show the very key of this account": an nsec of someone else is not it.
import { getPublicKey, nip19 } from 'nostr-tools'

const NSEC = /nsec1[02-9ac-hj-np-z]{58}/g

/** True when the kind 0 content of `pubkey` contains that account's own private key (as an nsec). Never throws. */
export function keyIsPublic(pubkey: string, content: string): boolean {
  for (const m of content.toLowerCase().matchAll(NSEC)) {
    try {
      const d = nip19.decode(m[0])
      if (d.type === 'nsec' && getPublicKey(d.data) === pubkey) return true
    } catch { /* not a valid nsec: keep looking */ }
  }
  return false
}
