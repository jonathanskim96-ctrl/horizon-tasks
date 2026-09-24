/**
 * The ONE write guard for the app. Every write passes a key describing the
 * action (e.g. `complete:<taskId>`, `save:new-task`).
 *  - Same key while in flight (double-tap): the caller gets the *same* promise,
 *    so there's no duplicate write and no false "done".
 *  - Different key while in flight: rejects with BusyError, which the UI shows.
 * Do not add a second guard anywhere — nested guards caused every save to
 * silently fail in the artifact version.
 */
export class BusyError extends Error {
  constructor() {
    super('Another change is still saving — try again in a moment.')
    this.name = 'BusyError'
  }
}

let inFlight: { key: string; promise: Promise<unknown> } | null = null

export function guardedWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight) {
    if (inFlight.key === key) return inFlight.promise as Promise<T>
    return Promise.reject(new BusyError())
  }
  // fn runs in a microtask, after inFlight is set, so even a synchronous throw
  // can't leave the guard stuck.
  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      inFlight = null
    })
  inFlight = { key, promise }
  return promise
}

export const isWriting = () => inFlight !== null
