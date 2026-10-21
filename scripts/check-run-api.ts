// api/run.ts 자체 점검: node scripts/check-run-api.ts
import assert from 'node:assert/strict'

process.env.RUN_PASSWORD = 'pw'
process.env.GH_TOKEN = 'tok'
const calls: { url: string; body?: string }[] = []
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url, body: init?.body as string })
  return Response.json({ workflow_runs: [] })
}) as typeof fetch

const { POST } = await import('../api/run.ts')
const post = (b: object) => POST(new Request('http://x/api/run', { method: 'POST', body: JSON.stringify(b) }))

assert.equal((await post({ password: 'wrong', report: '전부' })).status, 401)
assert.equal((await post({ report: '전부' })).status, 401)
assert.equal((await post({ password: 'pw', report: '전부', month: '2026-13' })).status, 400)
assert.equal((await post({ password: 'pw', report: '없는화면' })).status, 400)
assert.equal(calls.length, 0, '거부된 요청은 GitHub 호출 없음')

assert.equal((await post({ password: 'pw', report: '수출매출품목조회', month: '2026-09', load: true })).status, 200)
assert.match(calls[0].url, /finance-db-loader\/actions\/workflows\/erp\.yml\/dispatches$/)
assert.deepEqual(JSON.parse(calls[0].body!), {
  ref: 'main', inputs: { month: '2026-09', report: '수출매출품목조회', load: true },
})

delete process.env.RUN_PASSWORD
assert.equal((await post({ password: '', report: '전부' })).status, 401, '비밀번호 미설정이면 항상 거부')
console.log('ok')
