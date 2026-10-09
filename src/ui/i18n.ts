// English and Spanish. The reasons the filter gives are sentences built from the verdict's params, so they translate like any other text.
import type { RuleId, Verdict } from '../core/verdict.js'

export type Lang = 'en' | 'es'

const en = {
  tagline: 'Text only. Tells you why it hides things.',
  updateAvailable: 'A new version of Quill is available.', updateNow: 'Update',
  refresh: 'Refresh', installTitle: 'Install Quill', installHint: 'Tap Share, then "Add to Home Screen". The installed app keeps its own data: you will log in and connect Clave again there.',
  following: 'Following', mentions: 'Mentions', showMore: 'Show more ({n} left)', me: 'Me', myNotes: 'My notes', connectToWrite: 'Connect Clave to react, reply and write', signOut: 'Sign out', language: 'Español',
  loginTitle: 'Read as…', loginHelp: 'Paste an npub (or hex key). Quill only reads: it never asks for a private key to read.',
  loginPlaceholder: 'npub1…', loginButton: 'Read', loginBad: 'That does not look like an npub or a 64-character hex key.',
  loading: 'Loading…', loadingFollows: 'Reading who you follow…', loadingFeed: 'Loading notes…', empty: 'Nothing here yet.', noNote: 'Could not find that note on the relays.',
  thread: 'Thread', back: 'Back', replies: 'replies', root: 'Thread start',
  hiddenSummary: '{shown} shown · {hidden} hidden', hiddenNothing: 'Nothing hidden', filterSettings: 'Filter settings', closeSettings: 'Close settings',
  show: 'show', hide: 'hide', hiddenBy: 'Hidden', byLabel: 'by',
  settingsTitle: 'Filter settings', settingsHelp: 'Every rule can be switched off. Nothing is deleted: hidden notes stay one tap away.',
  ruleRepeated: 'Repeated text', ruleBurst: 'Bursts of notes', ruleLinks: 'Link-only accounts', ruleNetwork: 'Outside your network',
  distance: 'Network reach', distance1: 'People you follow', distance2: 'Follows and their follows',
  mutedWords: 'Muted words (this device)', mutedWordsHelp: 'One per line.', graphInfo: 'Follow graph: {answered} of {total} follow lists loaded.',
  graphOff: 'The follow graph did not load enough, so "outside your network" is off.',
  tally_muted_author: 'muted accounts', tally_muted_word: 'muted words', tally_repeated_text: 'repeated text', tally_burst: 'bursts', tally_link_only: 'link-only', tally_outside_network: 'outside your network',
  r_muted_author: 'You muted this account.',
  r_muted_word: 'It contains "{word}", a word you muted.',
  r_repeated_text: '{shared} of this account\'s {total} notes repeat text that other accounts also post.',
  r_burst: 'This account posted {events} notes in {seconds} seconds.',
  r_link_only: '{withLink} of this account\'s {total} notes carry links and little else.',
  r_outside_network: 'This account is more than {max} hops from you in the follow graph.',
  r_outside_network_none: 'No path from you to this account within {max} hops.',
  now: 'now', openLink: 'link',
  bunkerTitle: 'Recommended: paste the bunker address from Clave', bunkerHelp: 'In Clave, copy the connection address (it starts with bunker://) and paste it here. This way Clave can sign even when it is in the background.',
  pasteAndConnect: 'Paste and connect', clipboardNoBunker: 'The clipboard does not hold a bunker:// address. Copy it in Clave first.', useLinkInstead: 'Use a link instead', linkHelp: 'Open the link on the phone where Clave is installed and keep this page open while you approve. With a link, Clave has to stay open on screen to sign.', connectingBunker: 'Connecting to Clave…',
  connectSigner: 'Connect Clave', connectTitle: 'Sign with Clave', signingAs: 'Signing as {who}', disconnectSigner: 'Disconnect',
  connectHelp: 'Quill never sees your private key: Clave signs, and you approve each request there.',
  openClave: 'Open in Clave', copyLink: 'Copy link', copied: 'Copied', bunkerLabel: 'or paste a bunker:// address', bunkerButton: 'Connect',
  connectWaiting: 'Waiting for Clave to approve the connection.', resuming: 'Reconnecting to Clave…',
  connectFailed: 'Could not connect: {why}', wrongAccount: 'That signer belongs to another account ({who}), not the one you are reading as. It was disconnected.',
  newNote: 'Write a note…', replyingTo: 'Replying to {who}', review: 'Review', cancel: 'Cancel', backEdit: 'Back', publish: 'Publish', reply: 'Reply', react: 'React',
  chars: '{n} / {max}', previewTitle: 'You are about to publish as {who}', previewPublic: 'It is public. Deleting it later is only a request that relays may ignore.',
  previewRelays: 'Sent to {n} relays', previewReplyTo: 'In reply to {who}', previewMentions: 'Notifies {n} people',
  p_kind: 'Quill only signs notes and reactions.', p_empty: 'The note is empty.', p_too_long: 'The note is too long (limit {max} characters).', p_reaction: 'That is not a valid reaction.', p_tags: 'The note has invalid tags.', p_reaction_target: 'A reaction needs a note to react to.',
  cancelledSigning: 'Cancelled. Nothing was published.', step_waiting: 'Waiting for Clave… If it takes long, open Clave or tap its notification.', step_sending: 'Sending to the relays…',
  e_rate: 'Too many signatures in the last hour. Try again later.', e_no_signer: 'Connect Clave first.', e_asleep: 'Clave did not answer in time. Open it on screen (or tap its blank notification) and try again. Nothing was published.', e_not_signed: 'Clave did not sign: {why}. Nothing was published.',
  published: 'Published to {ok} of {total} relays', publishedNone: 'Signed, but no relay accepted it', retryFailed: 'Retry the failed relays', done: 'Done', dismiss: 'Close',
}
export type Key = keyof typeof en

const es: Record<Key, string> = {
  tagline: 'Solo texto. Te dice por qué oculta cosas.',
  updateAvailable: 'Hay una nueva versión de Quill.', updateNow: 'Actualizar',
  refresh: 'Actualizar', installTitle: 'Instalar Quill', installHint: 'Pulsa Compartir y luego «Añadir a pantalla de inicio». La app instalada guarda sus propios datos: tendrás que volver a entrar y a conectar Clave allí.',
  following: 'Siguiendo', mentions: 'Menciones', showMore: 'Mostrar más (quedan {n})', me: 'Yo', myNotes: 'Mis notas', connectToWrite: 'Conecta Clave para reaccionar, responder y escribir', signOut: 'Salir', language: 'English',
  loginTitle: 'Leer como…', loginHelp: 'Pega un npub (o clave hex). Quill solo lee: para leer nunca pide una clave privada.',
  loginPlaceholder: 'npub1…', loginButton: 'Leer', loginBad: 'Eso no parece un npub ni una clave hex de 64 caracteres.',
  loading: 'Cargando…', loadingFollows: 'Leyendo a quién sigues…', loadingFeed: 'Cargando notas…', empty: 'Aún no hay nada.', noNote: 'No se encontró esa nota en los relés.',
  thread: 'Hilo', back: 'Volver', replies: 'respuestas', root: 'Inicio del hilo',
  hiddenSummary: '{shown} visibles · {hidden} ocultas', hiddenNothing: 'Nada oculto', filterSettings: 'Ajustes del filtro', closeSettings: 'Cerrar ajustes',
  show: 'ver', hide: 'ocultar', hiddenBy: 'Oculta', byLabel: 'por',
  settingsTitle: 'Ajustes del filtro', settingsHelp: 'Cada regla se puede apagar. No se borra nada: lo oculto queda a un toque.',
  ruleRepeated: 'Texto repetido', ruleBurst: 'Ráfagas de notas', ruleLinks: 'Cuentas que solo ponen enlaces', ruleNetwork: 'Fuera de tu red',
  distance: 'Alcance de tu red', distance1: 'Gente que sigues', distance2: 'Tus seguidos y los suyos',
  mutedWords: 'Palabras silenciadas (este dispositivo)', mutedWordsHelp: 'Una por línea.', graphInfo: 'Grafo de seguimiento: {answered} de {total} listas cargadas.',
  graphOff: 'El grafo de seguimiento no cargó lo bastante, así que «fuera de tu red» está desactivado.',
  tally_muted_author: 'cuentas silenciadas', tally_muted_word: 'palabras silenciadas', tally_repeated_text: 'texto repetido', tally_burst: 'ráfagas', tally_link_only: 'solo enlaces', tally_outside_network: 'fuera de tu red',
  r_muted_author: 'Silenciaste esta cuenta.',
  r_muted_word: 'Contiene «{word}», una palabra que silenciaste.',
  r_repeated_text: '{shared} de las {total} notas de esta cuenta repiten un texto que también publican otras cuentas.',
  r_burst: 'Esta cuenta publicó {events} notas en {seconds} segundos.',
  r_link_only: '{withLink} de las {total} notas de esta cuenta llevan enlaces y poco más.',
  r_outside_network: 'Esta cuenta está a más de {max} saltos de ti en el grafo de seguimiento.',
  r_outside_network_none: 'No hay camino desde ti hasta esta cuenta en {max} saltos.',
  now: 'ahora', openLink: 'enlace',
  bunkerTitle: 'Recomendado: pega la dirección bunker de Clave', bunkerHelp: 'En Clave, copia la dirección de conexión (empieza por bunker://) y pégala aquí. Así Clave puede firmar aunque esté en segundo plano.',
  pasteAndConnect: 'Pegar y conectar', clipboardNoBunker: 'El portapapeles no tiene una dirección bunker://. Cópiala primero en Clave.', useLinkInstead: 'Usar un enlace en su lugar', linkHelp: 'Abre el enlace en el móvil donde tienes Clave y no cierres esta página mientras apruebas. Con un enlace, Clave tiene que estar abierta en pantalla para firmar.', connectingBunker: 'Conectando con Clave…',
  connectSigner: 'Conectar Clave', connectTitle: 'Firmar con Clave', signingAs: 'Firmando como {who}', disconnectSigner: 'Desconectar',
  connectHelp: 'Quill nunca ve tu clave privada: firma Clave y tú apruebas cada petición allí.',
  openClave: 'Abrir en Clave', copyLink: 'Copiar enlace', copied: 'Copiado', bunkerLabel: 'o pega una dirección bunker://', bunkerButton: 'Conectar',
  connectWaiting: 'Esperando a que Clave apruebe la conexión.', resuming: 'Reconectando con Clave…',
  connectFailed: 'No se pudo conectar: {why}', wrongAccount: 'Ese firmador es de otra cuenta ({who}), no de la que estás leyendo. Se desconectó.',
  newNote: 'Escribe una nota…', replyingTo: 'Respondiendo a {who}', review: 'Revisar', cancel: 'Cancelar', backEdit: 'Volver', publish: 'Publicar', reply: 'Responder', react: 'Reaccionar',
  chars: '{n} / {max}', previewTitle: 'Vas a publicar como {who}', previewPublic: 'Es público. Borrarlo después es solo una petición que los relés pueden ignorar.',
  previewRelays: 'Se envía a {n} relés', previewReplyTo: 'En respuesta a {who}', previewMentions: 'Avisa a {n} personas',
  p_kind: 'Quill solo firma notas y reacciones.', p_empty: 'La nota está vacía.', p_too_long: 'La nota es demasiado larga (límite {max} caracteres).', p_reaction: 'Esa reacción no es válida.', p_tags: 'La nota tiene etiquetas no válidas.', p_reaction_target: 'Una reacción necesita una nota a la que reaccionar.',
  cancelledSigning: 'Cancelado. No se publicó nada.', step_waiting: 'Esperando a Clave… Si tarda, abre Clave o pulsa su notificación.', step_sending: 'Enviando a los relés…',
  e_rate: 'Demasiadas firmas en la última hora. Inténtalo más tarde.', e_no_signer: 'Conecta primero Clave.', e_asleep: 'Clave no contestó a tiempo. Ábrela en pantalla (o pulsa su notificación en blanco) e inténtalo de nuevo. No se publicó nada.', e_not_signed: 'Clave no firmó: {why}. No se publicó nada.',
  published: 'Publicado en {ok} de {total} relés', publishedNone: 'Firmado, pero ningún relé lo aceptó', retryFailed: 'Reintentar los relés que fallaron', done: 'Hecho', dismiss: 'Cerrar',
}

const dict: Record<Lang, Record<Key, string>> = { en, es }

export function t(lang: Lang, key: Key, params: Record<string, string | number> = {}): string {
  return dict[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''))
}

const keyOf = (rule: RuleId) => rule.replace(/-/g, '_')

/** The sentence that explains a hidden note. */
export function reason(lang: Lang, v: Verdict): string {
  const none = v.rule === 'outside-network' && v.params.hops === 'none'
  return t(lang, (none ? 'r_outside_network_none' : `r_${keyOf(v.rule)}`) as Key, v.params)
}

export const tallyLabel = (lang: Lang, rule: RuleId): string => t(lang, `tally_${keyOf(rule)}` as Key)

export function ago(lang: Lang, unix: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round(nowMs / 1000 - unix))
  if (s < 45) return t(lang, 'now')
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'narrow' })
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), 'day')
  return new Date(unix * 1000).toISOString().slice(0, 10)
}

export function detectLang(languages: readonly string[] | undefined): Lang {
  return (languages ?? []).some((l) => l.toLowerCase().startsWith('es')) ? 'es' : 'en'
}

import type { Problem } from '../sign/policy.js'
export const problemText = (lang: Lang, p: Problem, params: Record<string, string | number> = {}): string => t(lang, `p_${p.replace(/-/g, '_')}` as Key, params)
