import { describe, expect, it } from 'vitest'
import { readAuthError } from './useSession'

describe('readAuthError', () => {
  it('reads OAuth errors from the query or hash', () => {
    expect(readAuthError({ search: '?error=access_denied&error_description=User+cancelled', hash: '' })).toBe('Sign-in failed: User cancelled')
    expect(readAuthError({ search: '', hash: '#error=server_error' })).toBe('Sign-in failed: server_error')
    expect(readAuthError({ search: '?code=abc', hash: '' })).toBe(null)
  })
  it('treats the message as plain text (rendered via React)', () => {
    expect(readAuthError({ search: '?error_description=%3Cimg%20src%3Dx%3E', hash: '' })).toBe('Sign-in failed: <img src=x>')
  })
})
