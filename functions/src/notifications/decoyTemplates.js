// Server-side mirror of src/data/notificationTemplates.js. The two can't
// literally share a file - this is a CommonJS Cloud Function, the frontend
// copy is an ES module Vite bundles into the PWA - but the content must stay
// identical, since the frontend copy exists only so the app can show the
// user what a notification looks like (e.g. in a settings preview), while
// this copy is what actually gets sent. Every template is deliberately
// generic: no mention of "case", "report", or any category name, in the
// subject, body, or preview text.
const DECOY_TEMPLATES = [
  { id: 'update-1', subject: 'You have an update', body: 'There is a new update waiting for you.', preview: 'New update available' },
  { id: 'update-2', subject: 'New activity', body: 'Something new is ready for your review.', preview: 'New activity to review' },
  { id: 'update-3', subject: 'Status changed', body: 'A status change occurred that may need your attention.', preview: 'Status has changed' },
  { id: 'update-4', subject: 'Reminder', body: "There's something you may want to check on.", preview: 'You have a reminder' },
  { id: 'update-5', subject: 'New message', body: 'A new message is available for you to read.', preview: 'New message waiting' },
  { id: 'update-6', subject: 'Action may be needed', body: 'Please check when you have a moment.', preview: 'Please check when free' },
  { id: 'update-7', subject: 'Something changed', body: 'A recent change is ready for you to view.', preview: 'Recent change to view' },
  { id: 'update-8', subject: 'Follow-up available', body: 'A follow-up is ready whenever you are.', preview: 'Follow-up ready' },
]

module.exports = { DECOY_TEMPLATES }
