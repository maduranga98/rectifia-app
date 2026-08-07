// WHY THIS MATTERS: a case's passcode is the only credential a reporter ever
// gets - there is no account, no recovery flow, and functions/src/intake/
// generateCaseAccess.js's own comments say the plaintext is returned exactly
// once. If hashing ever became unsalted or reversible, anyone who read the
// `cases` collection (an over-privileged rule, a leaked export, a compromised
// service account) could reconstruct a reporter's passcode and read - or
// worse, impersonate - their case. This suite pins the one-way, salted
// property so a well-meaning "let's cache the hash for speed" change can't
// quietly turn it into something crackable.
import { describe, it, expect } from 'vitest'
import { hashPasscode, randomPasscode } from '../intake/generateCaseAccess.js'

describe('passcodeHash', () => {
  it('hashes the same passcode differently across two calls (salted)', () => {
    const passcode = 'ABCD1234EFGH'
    const saltA = 'salt-one'
    const saltB = 'salt-two'

    const hashA = hashPasscode(passcode, saltA)
    const hashB = hashPasscode(passcode, saltB)

    expect(hashA).not.toBe(hashB)
  })

  it('verification succeeds against its own hash', () => {
    const passcode = randomPasscode()
    const salt = 'a-fixed-salt'
    const hash = hashPasscode(passcode, salt)

    expect(hashPasscode(passcode, salt)).toBe(hash)
  })

  it("verification fails against another passcode's hash", () => {
    const salt = 'shared-salt'
    const hashA = hashPasscode(randomPasscode(), salt)
    const hashB = hashPasscode(randomPasscode(), salt)

    expect(hashA).not.toBe(hashB)
  })

  it('the stored hash never contains the plaintext passcode', () => {
    const passcode = randomPasscode()
    const hash = hashPasscode(passcode, 'some-salt')

    expect(hash).not.toContain(passcode)
    // Nor any lowercase/uppercase variant of it landing in the hex output by
    // coincidence of encoding.
    expect(hash.toLowerCase()).not.toContain(passcode.toLowerCase())
  })

  it('generates passcodes long enough, and from an alphabet narrow enough, to resist guessing', () => {
    const passcode = randomPasscode()
    expect(passcode.length).toBe(12)
    // Excludes 0/O and 1/I/l by design (see generateCaseAccess.js) - assert
    // none of the ambiguous characters ever appear, not just that *a*
    // passcode was produced.
    expect(passcode).not.toMatch(/[0O1Il]/)
  })
})
