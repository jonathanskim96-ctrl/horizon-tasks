import { describe, expect, it } from 'vitest'
import { BusyError, guardedWrite, isWriting } from './writeGuard'

describe('guardedWrite', () => {
  it('dedupes a double-tap on the same action', async () => {
    let calls = 0
    const fn = async () => { calls++; return 'ok' }
    const [a, b] = await Promise.all([guardedWrite('save', fn), guardedWrite('save', fn)])
    expect([a, b, calls]).toEqual(['ok', 'ok', 1])
    expect(isWriting()).toBe(false)
  })
  it('rejects a different action visibly while busy', async () => {
    const first = guardedWrite('a', async () => 1)
    await expect(guardedWrite('b', async () => 2)).rejects.toBeInstanceOf(BusyError)
    await first
  })
  it('never gets stuck after a throw (sync or async)', async () => {
    await expect(guardedWrite('x', () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(guardedWrite('y', async () => { throw new Error('bang') })).rejects.toThrow('bang')
    await expect(guardedWrite('z', async () => 'fine')).resolves.toBe('fine')
  })
})
