// Decoy notification templates for anonymous reporter push notifications.
// Mirrored server-side at functions/src/notifications/decoyTemplates.js,
// which is what actually gets sent - this copy exists for the app to show
// the reporter what their notifications will look like, never to pick the
// template itself (that decision has to happen server-side, alongside
// lastTemplateId, or a client bug could repeat a template or leak content).
// Every template is deliberately generic: subject, body, and preview never
// mention "case", "report", or any category name.
export const NOTIFICATION_TEMPLATES = [
  { id: 'update-1', subject: 'You have an update', body: 'There is a new update waiting for you.', preview: 'New update available' },
  { id: 'update-2', subject: 'New activity', body: 'Something new is ready for your review.', preview: 'New activity to review' },
  { id: 'update-3', subject: 'Status changed', body: 'A status change occurred that may need your attention.', preview: 'Status has changed' },
  { id: 'update-4', subject: 'Reminder', body: "There's something you may want to check on.", preview: 'You have a reminder' },
  { id: 'update-5', subject: 'New message', body: 'A new message is available for you to read.', preview: 'New message waiting' },
  { id: 'update-6', subject: 'Action may be needed', body: 'Please check when you have a moment.', preview: 'Please check when free' },
  { id: 'update-7', subject: 'Something changed', body: 'A recent change is ready for you to view.', preview: 'Recent change to view' },
  { id: 'update-8', subject: 'Follow-up available', body: 'A follow-up is ready whenever you are.', preview: 'Follow-up ready' },
]
