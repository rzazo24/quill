// English and Spanish. The reasons the filter gives are sentences built from the verdict's params, so they translate like any other text.
import type { RuleId, Verdict } from '../core/verdict.js'

export type Lang = 'en' | 'es'

const en = {
  tagline: 'Text only. Tells you why it hides things.',
  updateAvailable: 'A new version of Quill is available.', updateNow: 'Update',
  replied: 'Replied', alreadyReacted: 'You already reacted with {emoji} to this note.', reactedWith: 'You reacted with {emoji}',
  reactionsTitle: 'Reactions to your notes', reactedOne: '{who} reacted to your note', reactedMany: '{who} and {n} more reacted to your note', newItems: '{n} new', newHidden: 'hidden by the filter: {n}', newMark: 'new',
  repostsTitle: 'Your notes, reposted', repostedYourOne: '{who} reposted your note', repostedYourMany: '{who} and {n} more reposted your note',
  followersTitle: 'New followers', followersMore: 'and {n} more',
  feedModeTitle: 'Show', feedMode_follows: 'Follows', feedMode_network: 'Network', followedByOne: 'Followed by {who}', followedByMany: 'Followed by {who} and {n} more',
  networkNotLoaded: 'Your network has not loaded yet: the lists of the people you follow did not arrive. Try refreshing.', networkEmpty: 'Nothing new from the people your follows follow.',
  avatarsTitle: 'Avatars', avatar_initials: 'Initials', avatar_robots: 'Robots', avatar_pixels: 'Pixels',
  repostedOne: '{who} reposted', repostedMany: '{who} and {n} more reposted', showReposts: 'Show what the people I follow repost',
  helpTitle: 'Help', helpSource: 'Open source (MIT). Code, issues and ideas:', prefsTitle: 'Settings', fontTitle: 'Text size', font_small: 'Small', font_normal: 'Normal', font_large: 'Large', font_xlarge: 'Very large',
  relaysTitle: 'Relays', relaysHelp: 'Quill reads from these relays and publishes your reactions and notes to them. Each relay sees your IP address and what you publish. Only secure addresses (wss://) are accepted. Connecting your signer (Clave) uses its own relays and is not affected.',
  relayAdd: 'Add', relayPlaceholder: 'relay.example.com', relayRemove: 'Remove', relayTest: 'Test', relayTesting: 'Testing…', relayUp: 'Answers', relayDown: 'No answer', relayReset: 'Restore the default relays', relayLast: 'At least one relay is needed.',
  relayBad: 'That is not a valid secure relay address (wss://relay.example.com).', relayDup: 'That relay is already in the list.', relayFull: 'The list is full (10 relays).',
  listNone: 'You have not published your relay list on Nostr yet.', listSame: 'The relay list you published on Nostr is this one.', listDiffers: 'The relay list you published on Nostr is different (relays: {n}).',
  listUse: 'Use the published list', listPublish: 'Publish this list on Nostr', listNeedSigner: 'Connect Clave (in Me) to publish this list.',
  listConfirm: 'This is public: anyone, and other Nostr apps, will see these {n} relays as the ones you read from and write to. Your signer will ask you to approve it.', listSign: 'Sign and publish', listCancel: 'Cancel', listDone: 'Relay list published', listAdopted: 'Relays loaded from your list on Nostr ({n}).',
  refresh: 'Refresh', installTitle: 'Install Quill', installHint: 'Tap Share, then "Add to Home Screen". The installed app keeps its own data: you will log in and connect Clave again there.',
  following: 'Following', mentions: 'Mentions', showMore: 'Show more ({n} left)', me: 'Me', myNotes: 'My notes', connectToWrite: 'Connect Clave to react, reply and write', signOut: 'Sign out', language: 'Español',
  loginTitle: 'Read as…', loginHelp: 'Paste an npub (or hex key). Quill only reads: it never asks for a private key to read.',
  loginPlaceholder: 'npub1…', loginButton: 'Read', loginBad: 'That does not look like an npub or a 64-character hex key.',
  loading: 'Loading…', loadingFollows: 'Reading who you follow…', loadingFeed: 'Loading notes…', empty: 'Nothing here yet.', noNote: 'Could not find that note on the relays.',
  thread: 'Thread', quotedNote: 'Quoted note', quotedFrom: 'Quoted from this note:', back: 'Back', replies: 'replies', root: 'Thread start',
  hiddenSummary: '{shown} shown · {hidden} hidden', hiddenNothing: 'Nothing hidden', filterSettings: 'Filter settings', closeSettings: 'Close settings',
  show: 'show', hide: 'hide', hiddenBy: 'Hidden', byLabel: 'by',
  settingsTitle: 'Filter settings', switchHelp: 'On = the rule hides what meets its condition. Off = it hides nothing.', settingsHelp: 'Every rule can be switched off. Nothing is deleted: hidden notes stay one tap away.',
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
  connectSigner: 'Connect Clave', connectTitle: 'Sign with Clave', signerConnected: 'Clave connected', confirmDisconnect: 'Disconnect Clave? To sign again you will have to connect it again with its bunker:// address.', signingAs: 'Signing as {who}', disconnectSigner: 'Disconnect',
  connectHelp: 'Quill never sees your private key: Clave signs, and you approve each request there.',
  openClave: 'Open in Clave', copyLink: 'Copy link', copied: 'Copied', bunkerLabel: 'or paste a bunker:// address', bunkerButton: 'Connect',
  connectWaiting: 'Waiting for Clave to approve the connection.', resuming: 'Reconnecting to Clave…',
  connectFailed: 'Could not connect: {why}', wrongAccount: 'That signer belongs to another account ({who}), not the one you are reading as. It was disconnected.',
  newNote: 'Write a note…', replyingTo: 'Replying to {who}', review: 'Review', cancel: 'Cancel', backEdit: 'Back', publish: 'Publish', reply: 'Reply', react: 'React',
  chars: '{n} / {max}', previewTitle: 'You are about to publish as {who}', previewPublic: 'It is public. Deleting it later is only a request that relays may ignore.',
  previewRelays: 'Sent to {n} relays', previewReplyTo: 'In reply to {who}', previewMentions: 'Notifies {n} people',
  p_kind: 'Quill only signs notes, reactions and your relay list.', p_relay_list: 'That relay list is not valid.', p_empty: 'The note is empty.', p_too_long: 'The note is too long (limit {max} characters).', p_reaction: 'That is not a valid reaction.', p_tags: 'The note has invalid tags.', p_reaction_target: 'A reaction needs a note to react to.',
  cancelledSigning: 'Cancelled. Nothing was published.', step_waiting: 'Waiting for Clave… If it takes long, open Clave or tap its notification.', step_sending: 'Sending to the relays…',
  e_rate: 'Too many signatures in the last hour. Try again later.', e_no_signer: 'Connect Clave first.', e_asleep: 'Clave did not answer in time. Open it on screen (or tap its blank notification) and try again. Nothing was published.', e_not_signed: 'Clave did not sign: {why}. Nothing was published.',
  published: 'Published to {ok} of {total} relays', publishedNone: 'Signed, but no relay accepted it', retryFailed: 'Retry the failed relays', done: 'Done', dismiss: 'Close',
}
export type Key = keyof typeof en

const es: Record<Key, string> = {
  tagline: 'Solo texto. Te dice por qué oculta cosas.',
  updateAvailable: 'Hay una nueva versión de Quill.', updateNow: 'Actualizar',
  replied: 'Respondida', alreadyReacted: 'Ya has reaccionado con {emoji} a esta nota.', reactedWith: 'Reaccionaste con {emoji}',
  reactionsTitle: 'Reacciones a tus notas', reactedOne: '{who} reaccionó a tu nota', reactedMany: '{who} y {n} más reaccionaron a tu nota', newItems: '{n} nuevas', newHidden: 'ocultas por el filtro: {n}', newMark: 'nueva',
  repostsTitle: 'Tus notas compartidas', repostedYourOne: '{who} compartió tu nota', repostedYourMany: '{who} y {n} más compartieron tu nota',
  followersTitle: 'Nuevos seguidores', followersMore: 'y {n} más',
  feedModeTitle: 'Mostrar', feedMode_follows: 'Seguidos', feedMode_network: 'Red', followedByOne: 'Seguida por {who}', followedByMany: 'Seguida por {who} y {n} más',
  networkNotLoaded: 'Tu red aún no ha cargado: no llegaron las listas de la gente que sigues. Prueba a actualizar.', networkEmpty: 'Nada nuevo de la gente a la que siguen tus seguidos.',
  avatarsTitle: 'Avatares', avatar_initials: 'Iniciales', avatar_robots: 'Robots', avatar_pixels: 'Píxeles',
  repostedOne: '{who} compartió', repostedMany: '{who} y {n} más compartieron', showReposts: 'Mostrar lo que comparte la gente que sigo',
  helpTitle: 'Ayuda', helpSource: 'Código abierto (MIT). Código, incidencias e ideas:', prefsTitle: 'Ajustes', fontTitle: 'Tamaño del texto', font_small: 'Pequeño', font_normal: 'Normal', font_large: 'Grande', font_xlarge: 'Muy grande',
  relaysTitle: 'Relés', relaysHelp: 'Quill lee de estos relés y publica en ellos tus reacciones y notas. Cada relé ve tu dirección IP y lo que publicas. Solo se aceptan direcciones seguras (wss://). La conexión con tu firmador (Clave) usa sus propios relés y no se ve afectada.',
  relayAdd: 'Añadir', relayPlaceholder: 'relay.ejemplo.com', relayRemove: 'Quitar', relayTest: 'Probar', relayTesting: 'Probando…', relayUp: 'Responde', relayDown: 'Sin respuesta', relayReset: 'Restaurar los relés por defecto', relayLast: 'Hace falta al menos un relé.',
  relayBad: 'Esa no es una dirección de relé segura válida (wss://relay.ejemplo.com).', relayDup: 'Ese relé ya está en la lista.', relayFull: 'La lista está llena (10 relés).',
  listNone: 'Todavía no has publicado tu lista de relés en Nostr.', listSame: 'La lista de relés que publicaste en Nostr es esta.', listDiffers: 'La lista de relés que publicaste en Nostr es distinta (relés: {n}).',
  listUse: 'Usar la lista publicada', listPublish: 'Publicar esta lista en Nostr', listNeedSigner: 'Conecta Clave (en Yo) para publicar esta lista.',
  listConfirm: 'Esto es público: cualquiera, y otras apps de Nostr, verá estos {n} relés como aquellos de los que lees y en los que escribes. Tu firmador te pedirá que lo apruebes.', listSign: 'Firmar y publicar', listCancel: 'Cancelar', listDone: 'Lista de relés publicada', listAdopted: 'Relés cargados de tu lista en Nostr ({n}).',
  refresh: 'Actualizar', installTitle: 'Instalar Quill', installHint: 'Pulsa Compartir y luego «Añadir a pantalla de inicio». La app instalada guarda sus propios datos: tendrás que volver a entrar y a conectar Clave allí.',
  following: 'Siguiendo', mentions: 'Menciones', showMore: 'Mostrar más (quedan {n})', me: 'Yo', myNotes: 'Mis notas', connectToWrite: 'Conecta Clave para reaccionar, responder y escribir', signOut: 'Salir', language: 'English',
  loginTitle: 'Leer como…', loginHelp: 'Pega un npub (o clave hex). Quill solo lee: para leer nunca pide una clave privada.',
  loginPlaceholder: 'npub1…', loginButton: 'Leer', loginBad: 'Eso no parece un npub ni una clave hex de 64 caracteres.',
  loading: 'Cargando…', loadingFollows: 'Leyendo a quién sigues…', loadingFeed: 'Cargando notas…', empty: 'Aún no hay nada.', noNote: 'No se encontró esa nota en los relés.',
  thread: 'Hilo', quotedNote: 'Nota citada', quotedFrom: 'Citada desde esta nota:', back: 'Volver', replies: 'respuestas', root: 'Inicio del hilo',
  hiddenSummary: '{shown} visibles · {hidden} ocultas', hiddenNothing: 'Nada oculto', filterSettings: 'Ajustes del filtro', closeSettings: 'Cerrar ajustes',
  show: 'ver', hide: 'ocultar', hiddenBy: 'Oculta', byLabel: 'por',
  settingsTitle: 'Ajustes del filtro', switchHelp: 'Activada = la regla oculta lo que cumple su condición. Desactivada = no oculta nada.', settingsHelp: 'Cada regla se puede apagar. No se borra nada: lo oculto queda a un toque.',
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
  connectSigner: 'Conectar Clave', connectTitle: 'Firmar con Clave', signerConnected: 'Clave conectada', confirmDisconnect: '¿Desconectar Clave? Para volver a firmar tendrás que conectarla otra vez con su dirección bunker://.', signingAs: 'Firmando como {who}', disconnectSigner: 'Desconectar',
  connectHelp: 'Quill nunca ve tu clave privada: firma Clave y tú apruebas cada petición allí.',
  openClave: 'Abrir en Clave', copyLink: 'Copiar enlace', copied: 'Copiado', bunkerLabel: 'o pega una dirección bunker://', bunkerButton: 'Conectar',
  connectWaiting: 'Esperando a que Clave apruebe la conexión.', resuming: 'Reconectando con Clave…',
  connectFailed: 'No se pudo conectar: {why}', wrongAccount: 'Ese firmador es de otra cuenta ({who}), no de la que estás leyendo. Se desconectó.',
  newNote: 'Escribe una nota…', replyingTo: 'Respondiendo a {who}', review: 'Revisar', cancel: 'Cancelar', backEdit: 'Volver', publish: 'Publicar', reply: 'Responder', react: 'Reaccionar',
  chars: '{n} / {max}', previewTitle: 'Vas a publicar como {who}', previewPublic: 'Es público. Borrarlo después es solo una petición que los relés pueden ignorar.',
  previewRelays: 'Se envía a {n} relés', previewReplyTo: 'En respuesta a {who}', previewMentions: 'Avisa a {n} personas',
  p_kind: 'Quill solo firma notas, reacciones y tu lista de relés.', p_relay_list: 'Esa lista de relés no es válida.', p_empty: 'La nota está vacía.', p_too_long: 'La nota es demasiado larga (límite {max} caracteres).', p_reaction: 'Esa reacción no es válida.', p_tags: 'La nota tiene etiquetas no válidas.', p_reaction_target: 'Una reacción necesita una nota a la que reaccionar.',
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
