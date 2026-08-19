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
    return { uid, customClaims: user.customClaims }
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
    if (!this._users.has(uid)) {
      const err = new Error(`fakeAuth: no user ${uid}`)
      err.code = 'auth/user-not-found'
      throw err
    }
  }

  // Test-only helper: seed a user with custom claims before exercising the
  // function under test.
  seed(uid, customClaims = {}) {
    this._users.set(uid, { customClaims })
  }
}

module.exports = { FakeAuth }
