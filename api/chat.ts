// 대시보드 [AI 질문] → Claude API(도구 호출) → Supabase 집계 뷰·pivot_sales 조회 → 답변
// Vercel 환경변수: ANTHROPIC_API_KEY, CHAT_MODEL (선택)
// 인증: 대시보드 로그인 토큰(Authorization: Bearer). app_metadata.role 이 있는 사용자만 질문 가능
// AI는 SQL을 직접 쓰지 않고, 질문한 사용자의 권한(토큰)으로 아래 두 도구만 호출한다 → 읽는 범위는 Supabase RLS가 정함

// src/lib/supabase.ts 와 같은 브라우저 공개용 anon 키 (apikey 헤더용. 데이터 권한은 사용자 토큰이 정함)
const SB_URL = process.env.VITE_SUPABASE_URL ?? 'https://yggjkllldhhvfvcnsgko.supabase.co'
const SB_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlnZ2prbGxsZGhodmZ2Y25zZ2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTU3NzEsImV4cCI6MjEwNDkzMTc3MX0.kV9uuUmjEW4R7ImEsuySYwwO-vB1HcYpGAHyV5J4c7k'
const MODEL = process.env.CHAT_MODEL || 'claude-haiku-5-5'
const MAX_ROUNDS = 6 // 질문 1건당 도구 호출 왕복 한도 (비용 상한)
const MAX_ROWS = 200 // 도구 결과 1건당 AI에 넘기는 최대 행 수

export const VIEWS = [
  'v_sales_monthly_team',
  'v_sales_monthly_channel',
  'v_sales_monthly_item',
  'v_sales_monthly_customer',
  'v_sales_target_achievement',
]
const PIVOT_ROWS = ['sales_team', 'channel_type', 'customer_name', 'item_category', 'item_type', 'item_name', 'region', 'sales_source']
const COL = /^[a-z_]+$/

const json = (body: unknown, status = 200) => Response.json(body, { status })

// 토큰을 Supabase Auth 에 확인하고 역할이 있으면 토큰을 돌려줌 (없거나 만료면 null)
async function authed(request: Request): Promise<string | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!token) return null
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } }).catch(() => null)
  const user = r?.ok ? await r.json().catch(() => null) : null
  return user?.app_metadata?.role ? token : null
}

const month = { type: 'string', description: 'YYYY-MM' }
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description })
const METRICS =
  'total_qty 수량, total_supply_amount 매출액, total_cost 원가, total_profit 매출이익, costed_supply_amount 원가 반영 매출, profit_rate 이익률(%), row_count 건수, provisional_supply_amount 가결산 매출, provisional_profit 가결산 매출이익'

const TOOLS = [
  {
    name: 'query_view',
    description: `월별 집계 뷰 조회. 모든 뷰에 sales_month(YYYY-MM)가 있음.
* v_sales_monthly_team: 월 × sales_team(부서). ${METRICS}
* v_sales_monthly_channel: 월 × sales_team × channel_type(영업점구분) × region(권역). 지표 동일
* v_sales_monthly_item: 월 × item_type(품목소분류) × item_category(품목자산분류) × item_name(품명) × item_code. 지표 + avg_unit_price(평균단가), cost_month(적용 원가월)
* v_sales_monthly_customer: 월 × sales_team × customer_name(거래처). 지표 동일
* v_sales_target_achievement: 월 × sales_team. target_amount 매출목표, total_supply_amount 실적, achievement_rate 달성률(%)
거래처·품명처럼 정확한 이름을 모를 때는 filters 값에 %를 넣어 부분일치로 찾는다.`,
    input_schema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: VIEWS },
        from: month,
        to: month,
        filters: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: '열 이름 → 값. 값에 %가 있으면 부분일치, 없으면 정확히 일치. 예: {"customer_name":"%이마트%"}',
        },
        order_by: { type: 'string', description: '내림차순 정렬할 열. 예: total_supply_amount' },
      },
      required: ['view'],
    },
  },
  {
    name: 'pivot_sales',
    description: `fct_sales 원장을 행 기준(1~5개) × 월로 집계. 뷰에 없는 조합(예: 부서 × 품목, 권역 × 거래처)에 쓴다.
결과 행: key(행 기준 값을 ' / '로 연결), month, qty, supply(매출액), cost(원가), profit(매출이익), costed(원가 반영 매출). 매출액 큰 순.
행 기준 열: sales_team 부서, channel_type 영업점구분, customer_name 거래처, item_category 품목자산분류, item_type 품목소분류, item_name 품명, region 권역, sales_source 국내/수출.
teams·items 필터는 정확한 이름만 받으므로 모르면 query_view로 먼저 이름을 찾는다.`,
    input_schema: {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'string', enum: PIVOT_ROWS }, minItems: 1, maxItems: 5 },
        from: month,
        to: month,
        exclude_categories: strings("제외할 품목자산분류. '(빈값)'은 분류가 비어 있는 행"),
        channel: { type: 'string', description: "영업점구분 하나만: '영업점' 또는 'A/S팀'" },
        teams: strings('부서명 목록'),
        items: strings('품명 목록 (정확히 일치)'),
        sources: { type: 'array', items: { type: 'string', enum: ['국내', '수출'] } },
      },
      required: ['rows'],
    },
  },
]

const system = () => `너는 시즌글라스 매출 대시보드의 데이터 조회 도우미다. 오늘은 ${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}(한국 시간)이다.

규칙
* 숫자는 반드시 도구로 조회한 결과에서만 가져온다. 결과에 없으면 "데이터에서 찾을 수 없습니다"라고 하고 추측하지 않는다.
* 합계·비율을 직접 계산했으면 계산했다고 밝힌다.
* 한국어로 답한다. 결론을 먼저 1~3줄로 쓰고, 근거 숫자를 '* ' 목록으로 덧붙인다. 마크다운 표·제목·굵게는 쓰지 않는다.
* 금액은 원 단위에 천 단위 콤마. 큰 금액은 '1억 2,345만원'처럼 쓴다.
* 어떤 기간·조건으로 조회했는지 마지막에 한 줄로 적는다.
* 데이터 조회와 관계없는 요청은 정중히 거절한다.

데이터 정의
* 원천: 영림원 ERP 거래명세서품목조회(국내) + 수출매출품목조회(수출). 금액은 모두 부가세 별도 공급가액(원).
* 원가는 재고금액상세조회(결산 후 월 1회 적재)의 품목단위당원가 × 수량. 운송비·a/s 등과 원가 이력이 없는 품목은 원가가 없다(null).
* 가결산: 원가가 아직 확정되지 않은 월(결산 전)은 품목별 가장 최근 확정 원가로 원가·이익을 계산한 추정치다. 뷰의 provisional_supply_amount 가 0보다 큰 월이 가결산 월이다. 가결산 월의 원가·이익·이익률을 답할 때는 반드시 '가결산(결산 후 바뀔 수 있음)'이라고 밝힌다. 매출액·수량은 확정 값이다.
* 이익률(%) = 매출이익 ÷ 원가 반영 매출 × 100. 분모는 전체 매출액이 아니라 원가가 있는 행의 매출액이다. 직접 계산할 때도 이 정의를 따른다.
* 매출목표는 부가세 별도. 달성률 = 실적 ÷ 목표 × 100.
* 부서명은 그 달 기준이라 기간에 따라 다르다. 해외영업팀은 2026-05부터 영업2팀, 영업기획팀 거래처는 2026-08부터 영업1팀으로 집계된다. 여러 달을 비교할 때는 v_sales_monthly_team으로 그 기간의 부서명을 먼저 확인한다.
* channel_type(영업점구분): '영업점', 'A/S팀', 빈값. 빈값은 피벗 결과에서 '(빈값)'으로 나온다.`

type Rec = Record<string, unknown>

async function sb(token: string, path: string, init?: RequestInit) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(body?.message ?? `Supabase ${r.status}`)
  return body
}

const cap = (rows: unknown[]) =>
  rows.length > MAX_ROWS
    ? { rows: rows.slice(0, MAX_ROWS), note: `${MAX_ROWS}행까지만 표시함. 기간·필터를 좁히거나 order_by로 정렬해서 다시 조회할 것` }
    : { rows }

async function queryView(i: Rec, token: string) {
  if (!VIEWS.includes(i.view as string)) throw new Error(`알 수 없는 뷰: ${i.view}`)
  const q = new URLSearchParams({ select: '*', limit: String(MAX_ROWS + 1) })
  if (i.from) q.append('sales_month', `gte.${i.from}`)
  if (i.to) q.append('sales_month', `lte.${i.to}`)
  for (const [k, v] of Object.entries((i.filters ?? {}) as Rec)) {
    if (!COL.test(k)) throw new Error(`열 이름 오류: ${k}`)
    const s = String(v)
    q.append(k, s.includes('%') ? `ilike.${s.replaceAll('%', '*')}` : `eq.${s}`)
  }
  if (i.order_by) {
    if (!COL.test(i.order_by as string)) throw new Error(`열 이름 오류: ${i.order_by}`)
    q.set('order', `${i.order_by}.desc.nullslast`)
  }
  return cap(await sb(token, `${i.view}?${q}`))
}

type PivotRow = [string[], string, ...(number | null)[]]
async function pivot(i: Rec, token: string) {
  const rows: PivotRow[] = await sb(token, 'rpc/pivot_sales', {
    method: 'POST',
    body: JSON.stringify({
      p_rows: i.rows,
      p_from: i.from ?? null,
      p_to: i.to ?? null,
      p_exclude_categories: i.exclude_categories ?? null,
      p_channel: i.channel ?? null,
      p_teams: i.teams ?? null,
      p_items: i.items ?? null,
      p_sources: i.sources ?? null,
    }),
  })
  const out = rows.map(([k, month, qty, supply, cost, profit, costed]) => ({ key: k.join(' / '), month, qty, supply, cost, profit, costed }))
  out.sort((a, b) => (b.supply ?? 0) - (a.supply ?? 0))
  return cap(out)
}

const TOOL_FNS: Record<string, (i: Rec, token: string) => Promise<unknown>> = { query_view: queryView, pivot_sales: pivot }

interface Block { type: string; text?: string; id?: string; name?: string; input?: Rec }

async function claude(messages: unknown[]): Promise<{ stop_reason: string; content: Block[] }> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: 'text', text: system(), cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    }),
  })
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${body?.error?.message ?? ''}`)
  return body
}

interface Msg { role: 'user' | 'assistant'; content: string }
// user로 시작해 user로 끝나며 번갈아 오는 문자열 대화만 받음
const validHistory = (h: unknown): h is Msg[] =>
  Array.isArray(h) &&
  h.length % 2 === 1 &&
  h.length <= 21 &&
  h.every((m, i) => m?.role === (i % 2 ? 'assistant' : 'user') && typeof m.content === 'string' && m.content.length > 0 && m.content.length <= 4000)

export async function POST(request: Request) {
  const token = await authed(request)
  // ponytail: 호출량 제한은 없음. 로그인 계정이 늘면 Vercel Firewall rate limit 규칙 추가
  if (!token) return json({ error: '로그인이 만료됐습니다. 다시 로그인해 주세요' }, 401)
  const body = await request.json().catch(() => ({}))
  if (!validHistory(body.messages)) return json({ error: '대화 형식이 올바르지 않습니다' }, 400)
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY 환경변수가 없습니다' }, 500)

  // ponytail: 이전 턴의 도구 호출 내역은 보내지 않고 질문·답변 글만 이어 보냄 (토큰 절약). 후속 질문 때 필요하면 다시 조회함
  const messages: unknown[] = body.messages.map(({ role, content }: Msg) => ({ role, content }))
  const calls: { name: string; input: Rec }[] = []
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await claude(messages)
      if (res.stop_reason !== 'tool_use') {
        const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
        return json({ text, calls })
      }
      messages.push({ role: 'assistant', content: res.content })
      const results = await Promise.all(
        res.content
          .filter((b) => b.type === 'tool_use')
          .map(async (b) => {
            calls.push({ name: b.name!, input: b.input! })
            try {
              const fn = TOOL_FNS[b.name!]
              if (!fn) throw new Error(`알 수 없는 도구: ${b.name}`)
              return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await fn(b.input ?? {}, token)) }
            } catch (e) {
              return { type: 'tool_result', tool_use_id: b.id, content: (e as Error).message, is_error: true }
            }
          }),
      )
      messages.push({ role: 'user', content: results })
    }
    return json({ error: '조회 횟수 한도를 넘었습니다. 질문을 좁혀 주세요', calls }, 422)
  } catch (e) {
    return json({ error: (e as Error).message, calls }, 502)
  }
}
