// A minimal, in-memory stand-in for the pieces of the Firestore Admin SDK
// this test suite's production modules actually call: collection/doc
// get/set/update/delete, equality `where`, `orderBy`, `limit`, `add`,
// `runTransaction`, and `batch`. It exists so functions/src modules that call
// admin.firestore() internally can be exercised with real inputs and real
// assertions on what they write, without an emulator and without network -
// see the vitest.config.js / support/mockFirebaseAdmin.js comments for why
// this is the seam this suite mocks instead of Firestore itself.
//
// It is deliberately not a general Firestore emulator: it supports exactly
// the query shapes (`==` filters, single-field ordering) the modules under
// test issue, nothing more.

class FakeQuery {
  constructor(getDocs) {
    this._getDocs = getDocs
    this._filters = []
    this._order = null
    this._limitCount = null
  }

  where(field, op, value) {
    this._filters.push({ field, op, value })
    return this
  }

  orderBy(field, direction = 'asc') {
    this._order = { field, direction }
    return this
  }

  limit(count) {
    this._limitCount = count
    return this
  }

  async get() {
    let docs = this._getDocs()
    for (const { field, op, value } of this._filters) {
      docs = docs.filter((doc) => {
        const actual = doc.data()[field]
        if (op === '==') return actual === value
        throw new Error(`fakeFirestore: unsupported where() operator '${op}'`)
      })
    }
    if (this._order) {
      const { field, direction } = this._order
      docs = [...docs].sort((a, b) => {
        const av = a.data()[field]
        const bv = b.data()[field]
        if (av === bv) return 0
        const cmp = av < bv ? -1 : 1
        return direction === 'desc' ? -cmp : cmp
      })
    }
    if (this._limitCount != null) docs = docs.slice(0, this._limitCount)
    return { docs, size: docs.length, empty: docs.length === 0 }
  }
}

class FakeDocRef {
  constructor(store, path) {
    this._store = store
    this.path = path
    this.id = path.split('/').pop()
  }

  async get() {
    const data = this._store.get(this.path)
    return {
      id: this.id,
      exists: data !== undefined,
      data: () => data,
      ref: this,
    }
  }

  async set(data, options) {
    if (options?.merge) {
      this._store.set(this.path, { ...(this._store.get(this.path) || {}), ...data })
    } else {
      this._store.set(this.path, { ...data })
    }
  }

  async update(data) {
    if (!this._store.has(this.path)) {
      throw new Error(`fakeFirestore: update() on missing document ${this.path}`)
    }
    const current = { ...this._store.get(this.path) }
    for (const [key, value] of Object.entries(data)) {
      if (value && value.__fakeFieldValue === 'delete') {
        delete current[key]
      } else {
        current[key] = value
      }
    }
    this._store.set(this.path, current)
  }

  async delete() {
    this._store.delete(this.path)
  }

  collection(sub) {
    return new FakeCollectionRef(this._store, `${this.path}/${sub}`)
  }
}

class FakeCollectionRef {
  constructor(store, path) {
    this._store = store
    this.path = path
  }

  doc(id) {
    const docId = id ?? `auto_${Math.random().toString(36).slice(2, 10)}`
    return new FakeDocRef(this._store, `${this.path}/${docId}`)
  }

  async add(data) {
    const ref = this.doc()
    await ref.set(data)
    return ref
  }

  _docs() {
    const prefix = `${this.path}/`
    const docs = []
    for (const key of this._store.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (rest.includes('/')) continue // a subcollection document, not a direct child
      const data = this._store.get(key)
      const id = rest
      const ref = this.doc(id)
      docs.push({ id, exists: true, data: () => data, ref })
    }
    return docs
  }

  where(...args) {
    return new FakeQuery(() => this._docs()).where(...args)
  }

  orderBy(...args) {
    return new FakeQuery(() => this._docs()).orderBy(...args)
  }

  limit(...args) {
    return new FakeQuery(() => this._docs()).limit(...args)
  }

  async get() {
    return new FakeQuery(() => this._docs()).get()
  }
}

class FakeFirestore {
  constructor() {
    this._store = new Map()
  }

  collection(name) {
    return new FakeCollectionRef(this._store, name)
  }

  async runTransaction(updateFn) {
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, data, options) => {
        ref.set(data, options)
      },
      update: (ref, data) => {
        ref.update(data)
      },
    }
    return updateFn(tx)
  }

  batch() {
    const ops = []
    return {
      set: (ref, data, options) => ops.push(() => ref.set(data, options)),
      update: (ref, data) => ops.push(() => ref.update(data)),
      delete: (ref) => ops.push(() => ref.delete()),
      commit: async () => {
        for (const op of ops) await op()
      },
    }
  }

  // Test-only helper: seed a document directly, bypassing any production
  // write path, so a test can set up "the world as it already is" before
  // exercising the function under test.
  seed(collectionPath, id, data) {
    this._store.set(`${collectionPath}/${id}`, { ...data })
  }

  // Test-only helper: read back exactly what a production function wrote.
  peek(collectionPath, id) {
    return this._store.get(`${collectionPath}/${id}`)
  }
}

module.exports = { FakeFirestore }
