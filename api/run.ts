// 대시보드 [영림원 실행] 버튼 → 비밀번호 확인 → GitHub Actions(finance-db-loader) 실행
// Vercel 환경변수: RUN_PASSWORD (실행 비밀번호), GH_TOKEN (finance-db-loader 저장소 Actions 읽기·쓰기만 가진 fine-grained 토큰)
import { createHash, timingSafeEqual } from 'node:crypto'

const REPO = 'littletrace/finance-db-loader'
const WORKFLOW = 'erp.yml'
export const REPORTS = ['전부', '거래명세서품목조회', '수출매출품목조회', '재고금액상세조회']

const gh = (path: string, init?: RequestInit) =>
  fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

const json = (body: unknown, status = 200) => Response.json(body, { status })
const sha = (s: string) => createHash('sha256').update(s).digest()
const passwordOk = (input: unknown) => {
  const pw = process.env.RUN_PASSWORD
  return !!pw && typeof input === 'string' && timingSafeEqual(sha(input), sha(pw))
}

// 최근 실행 상태 (버튼의 '실행 중' 표시용. 상태·시각만 반환하므로 비밀번호 없이 조회)
export async function GET() {
  const r = await gh('runs?per_page=1')
  if (!r.ok) return json({ error: `GitHub ${r.status}` }, 502)
  const run = (await r.json()).workflow_runs?.[0]
  return json(run ? { status: run.status, conclusion: run.conclusion, createdAt: run.created_at } : null)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  if (!passwordOk(body.password)) {
    // ponytail: 실패 시 1초 지연만 둠. 시도 횟수 제한이 필요하면 Vercel Firewall rate limit 규칙 추가
    await new Promise((r) => setTimeout(r, 1000))
    return json({ error: '비밀번호가 틀렸습니다' }, 401)
  }
  const month = body.month || ''
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: '월은 YYYY-MM 형식' }, 400)
  if (!REPORTS.includes(body.report)) return json({ error: '알 수 없는 화면' }, 400)

  const r = await gh('dispatches', {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { month, report: body.report, load: body.load === true } }),
  })
  if (!r.ok) return json({ error: `GitHub ${r.status}: ${await r.text()}` }, 502)
  return json({ ok: true })
}
