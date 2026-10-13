/**
 * Raised when the mirror is stopped while a pass sits between awaits. The pass then abandons its work instead
 * of writing into a mirror the app has left, which after a sign-out or an account switch is somebody else's.
 */
export class MirrorAbandoned extends Error {
  constructor(accountId: string) {
    super(`The local mirror of ${accountId} stopped while it was catching up`)
    this.name = 'MirrorAbandoned'
  }
}
