// api/chat.ts 자체 점검: node scripts/check-chat-api.ts
import assert from 'node:assert/strict'

process.env.ANTHROPIC_API_KEY = 'key'
// 가짜 Supabase Auth: good = 역할 있음, norole = 로그인은 됐지만 역할 없음, 그 외 = 만료
const USERS: Record<string, object> = { good: { app_metadata: { role: 'admin' } }, norole: { app_metadata: {} } }
const sbCalls: string[] = []
const sbAuth: string[] = []
let claudeCalls = 0
const reply = (content: object[], stop_reason: string) => Response.json({ content, stop_reason })
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  if (url.includes('api.anthropic.com')) {
    const body = JSON.parse(init!.body as string)
    claudeCalls++
    if (claudeCalls === 1) {
      return reply([{ type: 'tool_use', id: 't1', name: 'query_view', input: {
        view: 'v_sales_monthly_customer', from: '2026-09', filters: { customer_name: '%이마트%' }, order_by: 'total_supply_amount' } }], 'tool_use')
    }
    if (claudeCalls === 2) {
      assert.equal(body.messages.at(-1).content[0].tool_use_id, 't1')
      assert.match(body.messages.at(-1).content[0].content, /이마트 성수/)
      return reply([{ type: 'tool_use', id: 't2', name: 'drop_table', input: {} }], 'tool_use')
    }
    assert.equal(body.messages.at(-1).content[0].is_error, true, '없는 도구는 오류로 돌려줌')
    return reply([{ type: 'text', text: '9월 이마트 매출은 1,000원입니다.' }], 'end_turn')
  }
  const auth = new Headers(init?.headers).get('authorization') ?? ''
  if (url.includes('/auth/v1/user')) {
    const u = USERS[auth.replace('Bearer ', '')]
    return u ? Response.json(u) : Response.json({ msg: 'invalid' }, { status: 401 })
  }
  sbCalls.push(decodeURIComponent(url))
  sbAuth.push(auth)
  return Response.json([{ sales_month: '2026-09', customer_name: '이마트 성수', total_supply_amount: 1000 }])
}) as typeof fetch

const { POST } = await import('../api/chat.ts')
const post = (b: object, token?: string) =>
  POST(new Request('http://x/api/chat', {
    method: 'POST', body: JSON.stringify(b), headers: token ? { Authorization: `Bearer ${token}` } : {},
  }))
const q = [{ role: 'user', content: '9월 이마트 매출?' }]

assert.equal((await post({ messages: q })).status, 401, '토큰 없음')
assert.equal((await post({ messages: q }, 'expired')).status, 401, '만료 토큰')
assert.equal((await post({ messages: q }, 'norole')).status, 401, '역할 없는 계정(공개 회원가입 등)')
assert.equal((await post({ messages: [] }, 'good')).status, 400)
assert.equal((await post({ messages: [{ role: 'assistant', content: 'x' }] }, 'good')).status, 400)
assert.equal((await post({ messages: [...q, { role: 'assistant', content: 'a' }] }, 'good')).status, 400, '질문으로 끝나야 함')
assert.equal(claudeCalls + sbCalls.length, 0, '거부된 요청은 Claude·DB 호출 없음')

const res = await post({ messages: q }, 'good')
assert.equal(res.status, 200)
const body = await res.json()
assert.equal(body.text, '9월 이마트 매출은 1,000원입니다.')
assert.equal(body.calls.length, 2)
assert.equal(sbCalls.length, 1)
assert.match(sbCalls[0], /\/rest\/v1\/v_sales_monthly_customer\?/)
assert.match(sbCalls[0], /sales_month=gte\.2026-09/)
assert.match(sbCalls[0], /customer_name=ilike\.\*이마트\*/)
assert.match(sbCalls[0], /order=total_supply_amount\.desc\.nullslast/)
assert.equal(sbAuth[0], 'Bearer good', 'DB는 질문한 사용자 토큰으로 조회 (anon 키 아님)')
console.log('ok')
