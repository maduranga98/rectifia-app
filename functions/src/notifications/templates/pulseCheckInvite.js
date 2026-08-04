// Reporter-facing template for a pulse-check invite.
//
// A pulse check goes to a roster employee who has no account and, critically,
// may be the subject or a bystander of a live case - the whole point of the
// wellness framing is that receiving this email reveals nothing. So the body
// is deliberately minimal: the company name, a neutral wellness check-in
// framing, and the single-use invite link. It MUST NOT contain the employee's
// answers (there are none yet - this is the invite), any case reference, or
// the words "case"/"report". Keep this template that way; the anonymity of
// every reporter depends on this email looking identical whether or not a
// case exists.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Builds the /pulse/{inviteId}?t={token} link from a configured base URL. The
// token is a single-use credential (see pulseInvites.js) and appears only in
// the outgoing email body - never logged.
function buildInviteLink(baseUrl, inviteId, token) {
  const trimmedBase = String(baseUrl || '').replace(/\/+$/, '')
  return `${trimmedBase}/pulse/${encodeURIComponent(inviteId)}?t=${encodeURIComponent(token)}`
}

function buildPulseCheckInviteEmail({ companyName, inviteId, token, baseUrl }) {
  const company = companyName || 'your organization'
  const inviteLink = buildInviteLink(baseUrl, inviteId, token)
  const subject = `A wellness check-in from ${company}`

  const text = [
    `${company} runs regular, confidential wellness check-ins to understand how the team is doing.`,
    '',
    'It takes just a couple of minutes and your responses are confidential.',
    '',
    'Open your check-in using the link below:',
    inviteLink,
    '',
    'This link is personal to you - please do not forward it.',
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin: 0 0 16px;">A wellness check-in</h2>
      <p><strong>${escapeHtml(company)}</strong> runs regular, confidential wellness check-ins to understand how the team is doing.</p>
      <p>It takes just a couple of minutes, and your responses are confidential.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(inviteLink)}" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 6px; display: inline-block;">Start check-in</a>
      </p>
      <p style="font-size: 13px; color: #666;">Or copy and paste this link into your browser:<br /><a href="${escapeHtml(inviteLink)}">${escapeHtml(inviteLink)}</a></p>
      <p style="font-size: 13px; color: #666;">This link is personal to you - please do not forward it.</p>
    </div>
  `

  return { subject, text, html }
}

module.exports = { buildPulseCheckInviteEmail, buildInviteLink }
