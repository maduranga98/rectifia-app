// Stands in for 'firebase-functions/v2/scheduler' - see aliasHttpsCjs.cjs
// for the pattern and support/setup.js for why it's wired up this way.
module.exports = {
  onSchedule: (schedule, handler) => handler,
}
