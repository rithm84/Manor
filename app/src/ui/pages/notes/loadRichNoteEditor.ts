import { singleFlight } from '../../singleFlight'

/**
 * The one request for the editor chunk, shared by the route warm-up, the lazy editor, and every chunk that
 * depends on it; see `singleFlight` for why a second overlapping request would crash or render unstyled.
 */
export const loadRichNoteEditor = singleFlight(() => import('./RichNoteEditor'))
