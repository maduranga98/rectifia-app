// Shared USD currency formatter for the package-selection UI
// (PackageSelector.jsx, PulseCheckToggle.jsx). BillingQuote.jsx and
// PlanFeaturesCard.jsx each already keep their own identical inline copy -
// a one-line Intl call isn't worth threading a shared dependency through
// files that predate this one, but two new sibling components sharing one
// card style should share this rather than diverge by accident.
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}
