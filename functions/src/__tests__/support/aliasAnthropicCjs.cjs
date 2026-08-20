// Stands in for '@anthropic-ai/sdk' - same pattern and same reason as
// mockFirebaseAdminCjs.cjs: the suite's stated design is "no Anthropic API
// calls" (see vitest.config.js's header comment), but modules like
// translateMessage.js require the real package at module load time, so
// something has to satisfy that require() without ever reaching the network.
//
// Global-scoped state for the same reason mockFirebaseAdminCjs.cjs uses it:
// this file is loaded once through Node's CJS resolver (production code's
// require) and once through Vite's ESM graph (a test file's import), and
// those are two different module registries.
const GLOBAL_KEY = '__rectifia_test_anthropic_state__'

function defaultHandler() {
  throw new Error(
    'Anthropic mock: no handler configured - call require("@anthropic-ai/sdk").__setHandler(fn) in this test'
  )
}

if (!globalThis[GLOBAL_KEY]) {
  globalThis[GLOBAL_KEY] = { handler: defaultHandler, calls: [] }
}
const state = globalThis[GLOBAL_KEY]

class Anthropic {
  constructor(options) {
    this.apiKey = options?.apiKey
    this.messages = {
      create: async (params) => {
        state.calls.push(params)
        return state.handler(params)
      },
    }
  }
}

Anthropic.__setHandler = (fn) => {
  state.handler = fn
}
Anthropic.__calls = () => state.calls
Anthropic.__reset = () => {
  state.handler = defaultHandler
  state.calls = []
}

module.exports = Anthropic
