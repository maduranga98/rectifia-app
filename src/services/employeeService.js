import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { firestore } from './firebase'

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'

// Firestore caps a batch at 500 writes; stay under it with room to spare so a
// large CSV import splits into several commits rather than failing outright.
const IMPORT_BATCH_SIZE = 400

// companies/{companyId}/employees is deliberately NOT the same collection as
// companies/{companyId}/staff. Staff are login-having accounts with a role and
// a Firebase Auth uid as their doc id (functions/src/staff/inviteStaff.js);
// employees are the people a Pulse Check goes out to and have no account at
// all, so their doc id is auto-generated and there is no role field to get
// confused with a staff role. Merging the two would mean every pulse-check
// recipient needs a login, which is the opposite of what module 14 needs.
function employeesCollection(companyId) {
  return collection(firestore, COMPANIES_COLLECTION, companyId, EMPLOYEES_SUBCOLLECTION)
}

// Email is optional on purpose: a company can load its roster (from HR export,
// a headcount list, anonymized IDs) long before it has - or is willing to
// share - work email addresses. Those employees still belong in the roster;
// schedulePulseChecks.js queues an invite for them and marks it as awaiting
// contact info rather than silently skipping the person.
function normalizeEmail(email) {
  const trimmed = String(email ?? '').trim()
  return trimmed ? trimmed.toLowerCase() : null
}

export function isDeliverable(employee) {
  return Boolean(employee?.email)
}

export async function listEmployees(companyId) {
  const snapshot = await getDocs(employeesCollection(companyId))
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
}

// `name` may be a real name or an anonymized identifier ("EMP-0412") - the
// roster only needs something stable to show the admin and to attribute a
// queued invite to, and a company running anonymized pulse checks should not
// have to invent names to use this.
export async function addEmployee(companyId, { name, department, email }) {
  const trimmedName = String(name ?? '').trim()
  if (!companyId) throw new Error('companyId is required')
  if (!trimmedName) throw new Error('Name or employee ID is required')

  const ref = await addDoc(employeesCollection(companyId), {
    name: trimmedName,
    department: String(department ?? '').trim() || null,
    email: normalizeEmail(email),
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateEmployee(companyId, employeeId, { name, department, email }) {
  const updates = { updatedAt: serverTimestamp() }
  if (name !== undefined) {
    const trimmedName = String(name).trim()
    if (!trimmedName) throw new Error('Name or employee ID is required')
    updates.name = trimmedName
  }
  if (department !== undefined) updates.department = String(department ?? '').trim() || null
  if (email !== undefined) updates.email = normalizeEmail(email)

  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId, EMPLOYEES_SUBCOLLECTION, employeeId), updates)
}

export async function removeEmployee(companyId, employeeId) {
  await deleteDoc(doc(firestore, COMPANIES_COLLECTION, companyId, EMPLOYEES_SUBCOLLECTION, employeeId))
}

// Minimal RFC-4180-shaped parser: handles quoted fields, embedded commas, and
// doubled quotes inside a quoted field. Written out rather than pulled in as a
// dependency because a staff roster CSV is the only CSV this app ever reads.
function splitCsvRow(row) {
  const cells = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i]
    if (inQuotes) {
      if (char === '"') {
        if (row[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells.map((value) => value.trim())
}

const HEADER_ALIASES = {
  name: 'name',
  'full name': 'name',
  employee: 'name',
  'employee id': 'name',
  'employee name': 'name',
  id: 'name',
  department: 'department',
  team: 'department',
  email: 'email',
  'email address': 'email',
  'work email': 'email',
}

// Turns raw CSV text into rows ready for importEmployees, plus per-row errors
// the admin can see and fix before anything is written. Nothing is imported
// from this function - the UI shows the preview first, so a mis-mapped column
// is caught before it becomes 800 bad employee docs.
export function parseEmployeeCsv(text) {
  const lines = String(text ?? '')
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== '')

  if (lines.length === 0) {
    return { employees: [], errors: [], headerError: 'The file is empty' }
  }

  const header = splitCsvRow(lines[0]).map((h) => HEADER_ALIASES[h.toLowerCase()] ?? null)
  if (!header.includes('name')) {
    return {
      employees: [],
      errors: [],
      headerError: 'The first row must be a header containing at least a "name" column',
    }
  }

  const employees = []
  const errors = []

  lines.slice(1).forEach((line, index) => {
    const cells = splitCsvRow(line)
    const row = { name: '', department: '', email: '' }
    header.forEach((field, columnIndex) => {
      if (field) row[field] = cells[columnIndex] ?? ''
    })

    // Row 1 is the header, so a data row's human-facing line number is +2.
    const lineNumber = index + 2
    if (!row.name) {
      errors.push({ lineNumber, message: 'Missing name / employee ID - row skipped' })
      return
    }
    // A malformed email is worth flagging but not worth dropping the employee
    // over: the roster entry is still valid, it just can't be delivered to
    // until someone fixes the address.
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push({ lineNumber, message: `"${row.email}" is not a valid email - imported without contact info` })
      row.email = ''
    }
    employees.push({ name: row.name, department: row.department, email: row.email })
  })

  return { employees, errors, headerError: null }
}

// Bulk-writes parsed rows. Existing employees are matched by email so
// re-importing an updated export refreshes names/departments in place instead
// of duplicating everyone; rows with no email are always added as new (there
// is nothing stable to match them on), which is the tradeoff for not
// requiring contact info.
export async function importEmployees(companyId, rows) {
  if (!companyId) throw new Error('companyId is required')
  if (!Array.isArray(rows) || rows.length === 0) {
    return { added: 0, updated: 0 }
  }

  const existing = await listEmployees(companyId)
  const byEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email, e.id]))

  let added = 0
  let updated = 0
  let batch = writeBatch(firestore)
  let pendingWrites = 0

  for (const row of rows) {
    const email = normalizeEmail(row.email)
    const payload = {
      name: String(row.name ?? '').trim(),
      department: String(row.department ?? '').trim() || null,
      email,
      status: 'active',
      updatedAt: serverTimestamp(),
    }
    if (!payload.name) continue

    const existingId = email ? byEmail.get(email) : undefined
    if (existingId) {
      batch.update(doc(firestore, COMPANIES_COLLECTION, companyId, EMPLOYEES_SUBCOLLECTION, existingId), payload)
      updated += 1
    } else {
      const ref = doc(employeesCollection(companyId))
      batch.set(ref, { ...payload, createdAt: serverTimestamp() })
      if (email) byEmail.set(email, ref.id)
      added += 1
    }

    pendingWrites += 1
    if (pendingWrites >= IMPORT_BATCH_SIZE) {
      await batch.commit()
      batch = writeBatch(firestore)
      pendingWrites = 0
    }
  }

  if (pendingWrites > 0) await batch.commit()

  return { added, updated }
}
