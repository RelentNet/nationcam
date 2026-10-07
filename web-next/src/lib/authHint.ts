// A cheap "this browser has a signed-in session" hint. Public pages do not ship
// the Logto SDK; they only load it when this is set (or the visitor clicks Sign
// In), so returning signed-in users still see their avatar. It is a UI hint
// only, never trusted: the SDK is the source of truth and clears it when it
// reports signed-out.
const KEY = 'nc_signed_in'

export function hasSignedInHint(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setSignedInHint(): void {
  try {
    window.localStorage.setItem(KEY, '1')
  } catch {
    /* storage unavailable: the hint just does not persist */
  }
}

export function clearSignedInHint(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
