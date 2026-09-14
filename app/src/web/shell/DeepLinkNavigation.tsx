import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/** One in-app navigation asked for by a deep link; a new object per link, so repeats of the same route still navigate. */
export interface RouteRequest { readonly route: string }

/**
 * Starts the app on a route that was waiting before the router existed, by writing it to the address
 * the router reads when it mounts. Navigating instead would leave the router on the launch address for
 * a moment, long enough for the catch-all route to redirect Home over the link that was waiting.
 * Returns the requests that arrive afterwards, which the router applies itself.
 */
export function useLaunchRoute(request: RouteRequest | null, onApplied: () => void): RouteRequest | null {
  const [launch] = useState(() => {
    if (request !== null) history.replaceState(null, '', request.route)
    return request
  })
  useEffect(() => { if (launch !== null) onApplied() }, [launch, onApplied])
  return request === launch ? null : request
}

/**
 * Applies each route request from the entry point once the router exists, and reports it consumed so a
 * remounted router never replays it.
 */
export function DeepLinkNavigation({ request, onApplied }: { request: RouteRequest | null; onApplied: () => void }): null {
  const navigate = useNavigate()
  useEffect(() => {
    if (request === null) return
    navigate(request.route)
    onApplied()
  }, [request, navigate, onApplied])
  return null
}
