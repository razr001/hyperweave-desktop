/** Opt-in authorization acceptance. Creates synthetic Skills and a role in a local test tenant. */
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'

const platform = new URL(process.env.HYPERWEAVE_PLATFORM_URL || 'http://127.0.0.1:28089')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(platform.hostname), 'Use a local test deployment')
assert.ok(process.env.HYPERWEAVE_TEST_CREDENTIALS, 'Provide the protected test credential file')
const credentials = JSON.parse(await readFile(process.env.HYPERWEAVE_TEST_CREDENTIALS, 'utf8'))
const evidence = resolve(process.env.HYPERWEAVE_TEST_EVIDENCE || '.desktop-next/catalog-evidence')
await mkdir(evidence, { recursive: true })

async function call(path, token, method = 'GET', body, expected = 200) {
  const response = await fetch(new URL(path, platform), { method, redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) })
  const result = await response.json()
  assert.equal(response.status, expected, `${method} ${path} returned HTTP ${response.status}`)
  assert.equal(result.code, expected >= 400 ? expected : 0, `${method} ${path} returned code ${result.code}`)
  return result.data
}

async function login(role) {
  assert.ok(credentials[`${role}Email`] && credentials[`${role}Password`], `Missing ${role} credentials`)
  const result = await call('/api/tenant/auth/login', null, 'POST', {
    email: credentials[`${role}Email`], password: credentials[`${role}Password`],
  })
  return result.access_token
}

const user = await login('user')
const admin = await login('admin')
const created = []
async function skill(label, roles, publish = true) {
  const row = await call('/api/skills', user, 'POST', {
    slug: `desktop-catalog-${randomUUID()}`, name: `Desktop catalog ${label}`, description: 'Synthetic authorization acceptance',
    manifest: { name: label, instructions: 'Retrieve selected knowledge and cite sources.',
      input_schema: { type: 'object' }, output_schema: { type: 'object' },
      allowed_roles: roles, capabilities: ['knowledge.search'], risk_level: 'LOW' },
  })
  created.push(row.id)
  if (publish) {
    const path = `/api/skills/${row.id}/versions/1`
    await call(`${path}/submit`, user, 'POST', {})
    await call(`${path}/review?approve=true`, admin, 'POST', { comment: 'Review synthetic read-only test Skill' })
    await call(`${path}/publish`, admin, 'POST', {})
  }
  return row.id
}

const allowed = await skill('member evidence', ['USER', 'TENANT_ADMIN'])
const restricted = await skill('administrator evidence', ['TENANT_ADMIN'])
const draft = await skill('unpublished evidence', ['USER'], false)
const catalog = await call('/api/skills/catalog', user)
assert.ok(catalog.some(row => row.id === allowed))
assert.ok(!catalog.some(row => [restricted, draft].includes(row.id)))
assert.ok((await call('/api/skills/catalog', admin)).some(row => row.id === restricted))
const role = { name: `Desktop catalog role ${Date.now()}`, role_description: 'Synthetic authorization acceptance',
  instructions: 'Cite selected evidence.', skill_ids: [allowed], plugin_ids: [] }
for (const skillId of [restricted, draft, randomUUID()]) {
  await call('/api/agent/profiles', user, 'POST', { ...role, skill_ids: [skillId] }, 403)
}
await call('/api/agent/profiles', user, 'POST', { ...role, skill_ids: [], plugin_ids: [randomUUID()] }, 403)
let profile = await call('/api/agent/profiles', user, 'POST', role, 201)
assert.deepEqual(profile.skill_ids, [allowed])
await call(`/api/agent/profiles/${profile.id}`, user, 'PUT', {
  ...role, revision: profile.revision, enabled: true, skill_ids: [allowed, restricted],
}, 403)
await call(`/api/skills/${allowed}/disable`, admin, 'POST', {})
assert.ok(!(await call('/api/skills/catalog', user)).some(row => row.id === allowed))
await call('/api/agent/profiles', user, 'POST', role, 403)
// The retained binding cannot execute, but must not trap users in an uneditable role.
profile = await call(`/api/agent/profiles/${profile.id}`, user, 'PUT', {
  ...role, revision: profile.revision, enabled: false,
})
assert.equal(profile.enabled, false)
profile = await call(`/api/agent/profiles/${profile.id}`, user, 'PUT', {
  ...role, revision: profile.revision, enabled: true, skill_ids: [],
})
assert.deepEqual(profile.skill_ids, [])
await call(`/api/agent/profiles/${profile.id}`, user, 'PUT', {
  ...role, revision: profile.revision, enabled: true,
}, 403)
await call(`/api/skills/${restricted}/disable`, admin, 'POST', {})

await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(),
  platform: platform.origin, skillIds: created, profileId: profile.id,
  checks: ['independent review and publication', 'role-filtered directory', 'draft and unknown Skill binding denied',
    'unknown plugin binding denied', 'authorized binding persisted', 'unauthorized update denied',
    'disabled Skill removed from directory and new bindings denied', 'retained disabled binding removable',
    'removed disabled binding cannot be re-added'] }, null, 2))
console.log('Real platform catalog and role binding authorization passed; evidence contains no credentials.')
