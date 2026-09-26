import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, limit, query, setDoc, updateDoc } from 'firebase/firestore'

// Regression tests for the two tenant-isolation guarantees firestore.rules
// makes that are easiest to break by accident: a Company Admin can never read
// another company, and a suspended or removed staff member loses access the
// moment their roster row changes (not when their ID token expires).

let env

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rectifia-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'companies/A'), { name: 'A', slug: 'a', billingStatus: 'unbilled' })
    await setDoc(doc(db, 'companies/B'), { name: 'B', slug: 'b', billingStatus: 'unbilled', stripeCustomerId: 'cus_b' })
    await setDoc(doc(db, 'companies/A/staff/admin'), { role: 'companyAdmin' })
    await setDoc(doc(db, 'companies/A/staff/hr'), { role: 'hrCoordinator' })
    await setDoc(doc(db, 'companies/A/staff/suspended'), { role: 'hrCoordinator', status: 'suspended' })
    await setDoc(doc(db, 'superAdmins/sa'), { uid: 'sa' })
  })
})

afterAll(async () => {
  await env?.cleanup()
})

const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore()
const companyAdmin = () => as('admin', { companyId: 'A', role: 'companyAdmin' })
const hr = () => as('hr', { companyId: 'A', role: 'hrCoordinator' })
// Still holds a valid ID token with its old claims - exactly the window the
// rules have to close on their own.
const suspended = () => as('suspended', { companyId: 'A', role: 'hrCoordinator' })
const removed = () => as('removed', { companyId: 'A', role: 'companyAdmin' })

describe('companies: tenant isolation', () => {
  it('Company Admin reads their own company', async () => {
    await assertSucceeds(getDoc(doc(companyAdmin(), 'companies/A')))
  })

  it('Company Admin cannot get another company', async () => {
    await assertFails(getDoc(doc(companyAdmin(), 'companies/B')))
  })

  it('Company Admin cannot list companies, even one at a time', async () => {
    await assertFails(getDocs(query(collection(companyAdmin(), 'companies'), limit(1))))
  })

  it('Super Admin can list companies', async () => {
    await assertSucceeds(getDocs(collection(as('sa'), 'companies')))
  })

  it('Company Admin can still edit an allowlisted field', async () => {
    await assertSucceeds(updateDoc(doc(companyAdmin(), 'companies/A'), { timeZone: 'UTC' }))
  })
})

describe('staff: suspension and removal take effect immediately', () => {
  it('active staff read their company and roster', async () => {
    await assertSucceeds(getDoc(doc(hr(), 'companies/A')))
    await assertSucceeds(getDocs(collection(hr(), 'companies/A/staff')))
  })

  it('suspended staff lose company and roster access', async () => {
    await assertFails(getDoc(doc(suspended(), 'companies/A')))
    await assertFails(getDocs(collection(suspended(), 'companies/A/staff')))
  })

  it('suspended staff can still read their own row (so the UI can sign them out)', async () => {
    await assertSucceeds(getDoc(doc(suspended(), 'companies/A/staff/suspended')))
  })

  it('removed staff (no roster row) lose read and write access', async () => {
    await assertFails(getDoc(doc(removed(), 'companies/A')))
    await assertFails(updateDoc(doc(removed(), 'companies/A'), { timeZone: 'X' }))
  })
})
