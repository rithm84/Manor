// Keeps an agent's OAuth flow in the agent's own browser window. The window opens Manor's consent screen in the
// desktop app, then waits for the app to hand back the return address and continues to it here, so the agent
// receives its callback in the window that started the flow.
const config = document.documentElement.dataset
const status = document.getElementById('status')
const retry = document.getElementById('open-manor')
const authorizationId = new URLSearchParams(location.search).get('authorization_id')
const POLL_MS = 1500
const GIVE_UP_MS = 15 * 60 * 1000

function show(message, failed) {
  status.textContent = message
  status.classList.toggle('failed', failed)
}

async function take() {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/manor_oauth_handoff_take`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_authorization_id: authorizationId })
  })
  if (!response.ok) throw new Error(`Manor answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return response.json()
}

async function wait(started) {
  if (Date.now() - started > GIVE_UP_MS) { show('This request expired. Start connecting again from the app that asked.', true); return }
  let address
  try { address = await take() }
  catch (failure) { console.warn('Checking for the Manor decision failed', failure); show('Lost touch with Manor. Still trying…', false); setTimeout(() => wait(started), POLL_MS * 2); return }
  if (typeof address === 'string') {
    const next = new URL(address)
    if (next.protocol !== 'https:' && next.protocol !== 'http:') { show('Manor returned an address this page will not open.', true); return }
    show('Finishing the connection…', false)
    location.replace(next.href)
    return
  }
  setTimeout(() => wait(started), POLL_MS)
}

if (authorizationId === null || authorizationId === '') {
  show('This connection request is missing its authorization ID. Start connecting again from the app that asked.', true)
  retry.hidden = true
} else {
  const deepLink = `${config.scheme}://oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
  retry.href = deepLink
  location.href = deepLink
  void wait(Date.now())
}
