// Flattens a case thread's messages into one evidence inventory - every
// attachment across every message, newest first, alongside who supplied it
// and which message it came from. Shared by CaseEvidencePanel.jsx (the
// handler's read-only Evidence tab) and ShareCasePanel.jsx (the file picker
// for an external share), so the two never drift on what "the case's
// evidence" means.
function supplierLabel(message) {
  if (message.type === 'manual_log') return 'Manual log entry'
  if (message.sender === 'ai') return 'AI assistant'
  if (message.sender === 'investigator') return 'Case Handler'
  return 'Reporter'
}

export function buildEvidenceInventory(messages) {
  return (messages ?? [])
    .flatMap((message) =>
      (message.attachments ?? []).map((attachment) => ({
        ...attachment,
        uploadedAt: message.timestamp,
        supplier: supplierLabel(message),
        messageId: message.id,
      }))
    )
    .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0))
}
