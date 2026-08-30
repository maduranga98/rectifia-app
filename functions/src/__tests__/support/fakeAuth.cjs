// A minimal, in-memory stand-in for the pieces of the Firebase Auth Admin
// SDK this test suite's production modules actually call: getUser,
// setCustomUserClaims, revokeRefreshTokens. Mirrors fakeFirestore.cjs's
// approach - seed users directly through the test-only `seed()` helper,
// then let production code read/write through the real admin.auth() surface.
class FakeAuth {
  constructor() {
    this._users = new Map()
  }

  async getUser(uid) {
    const user = this._users.get(uid)
    if (!user) {
      const err = new Error(`fakeAuth: no user ${uid}`)
      err.code = 'auth/user-not-found'
      throw err
    }
    return { uid, customClaims: user.customClaims, disabled: user.disabled === true }
  }

  // Mirrors the one field production code sets through updateUser today:
  // `disabled`, which functions/src/staff/setStaffStatus.js flips to lock a
  // suspended staff account out of Firebase Auth itself.
  async updateUser(uid, properties = {}) {
    const user = this._users.get(uid)
    if (!user) {
      const err = new Error(`fakeAuth: no user ${uid}`)
      err.code = 'auth/user-not-found'
      throw err
    }
    if ('disabled' in properties) user.disabled = properties.disabled === true
    return { uid, customClaims: user.customClaims, disabled: user.disabled === true }
  }

  async setCustomUserClaims(uid, claims) {
    const user = this._users.get(uid)
    if (!user) {
      const err = new Error(`fakeAuth: no user ${uid}`)
      err.code = 'auth/user-not-found'
      throw err
    }
    user.customClaims = claims
  }

  async revokeRefreshTokens(uid) {
    const user = this._users.get(uid)
    if (!user) {
      const err = new Error(`fakeAuth: no user ${uid}`)
      err.code = 'auth/user-not-found'
      throw err
    }
    // Counted rather than ignored so a test can assert that suspension ended
    // the sessions already open, not just blocked new sign-ins.
    user.revokeCount = (user.revokeCount ?? 0) + 1
  }

  // Test-only helper: seed a user with custom claims before exercising the
  // function under test.
  seed(uid, customClaims = {}) {
    this._users.set(uid, { customClaims, disabled: false, revokeCount: 0 })
  }

  // Test-only helper: the raw record, for asserting on `disabled` and
  // `revokeCount` after the function under test has run.
  record(uid) {
    return this._users.get(uid)
  }
}

module.exports = { FakeAuth }
