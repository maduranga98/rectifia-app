const { defineSecret, defineString } = require('firebase-functions/params')
const Stripe = require('stripe')

// Same defineSecret pattern as SMTP_PASSWORD (functions/src/utils/email.js)
// and ANTHROPIC_API_KEY (functions/src/intake/scoreCase.js): the value lives
// in Secret Manager, set with `firebase functions:secrets:set
// STRIPE_SECRET_KEY`, never in source or a plain .env file. Any function that
// calls getStripeClient() MUST declare `stripeSecretKey` in its own `secrets`
// array (see calculateQuote.js's sibling files in this directory) or the
// value is undefined at runtime, same rule as smtpPassword.
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY')

// Verifies the `Stripe-Signature` header on incoming webhook requests
// (stripeWebhook.js). A second, distinct secret from the API key - anyone
// who obtains this alone can forge webhook events but cannot call the
// Stripe API as this account, and vice versa.
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET')

// Where Stripe Checkout and the Billing Portal redirect back to. Same
// defineString + default pattern as APP_BASE_URL everywhere else it's
// used (inviteStaff.js, createCompanyAdmin.js, createShare.js,
// deliverNotifications.js, sendContactEmailUpdate.js) - deploy-time config,
// not a secret, and not trusted from the client on any individual request.
const appBaseUrl = defineString('APP_BASE_URL', { default: 'https://rectifia-59a1e.web.app' })

let cachedClient = null

// Lazily constructs (and caches, per function instance) the Stripe SDK
// client from the Secret Manager value. Not created at module load time:
// defineSecret()'s .value() is only populated once the function instance is
// actually invoked with the secret bound, so calling this before that point
// would cache an empty key.
function getStripeClient() {
  if (!cachedClient) {
    cachedClient = new Stripe(stripeSecretKey.value())
  }
  return cachedClient
}

module.exports = { stripeSecretKey, stripeWebhookSecret, appBaseUrl, getStripeClient }
