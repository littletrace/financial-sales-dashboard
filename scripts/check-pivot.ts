// 조회 탭 피벗 로직 점검: node scripts/check-pivot.ts
import assert from 'node:assert/strict'
import { PRESETS, buildTree, flatten, lastDay, sumCells, presetCfg, toCurrentTeams, toParams, value } from '../src/lib/pivot.ts'
import { currentTeam, dbTeams, hqOf } from '../src/lib/teams.ts'
import type { PivotRow } from '../src/lib/supabase.ts'

const p = (id: string) => toParams(presetCfg(PRESETS.find((x) => x.id === id)), '2026-01', '2026-10')

// 구 시트 조건이 그대로 RPC 파라미터로 나가는지
assert.deepEqual(p('team').exclude, ['운송비', '소모품', '서비스', 'a/s부품', '원자재']) // 조회3: 원자재·a/s까지 제외
assert.equal(p('team').sources, undefined)
assert.deepEqual(p('store'), {
  rows: ['customer_name', 'item_category'], from: '2026-01', to: '2026-10', exclude: ['운송비', '소모품', '서비스'],
  channel: '영업점', teams: null, items: undefined, sources: ['국내'],
}) // 조회4
assert.deepEqual(p('retail-item').teams?.slice().sort(), ['매장영업팀', '영업1팀', '영업2팀', '영업3팀', '영업기획팀', '유통사업팀', '온라인.구독영업팀', '해외영업팀', '화장품사업팀'].sort()) // 유통사업본부 + 옛 부서명

// 부서 통합: 옛 부서 → 현재 부서, 조회 조건은 옛 부서까지 넓힘, 결과 행은 현재 부서로 합쳐짐
assert.equal(currentTeam('유통사업팀'), '영업1팀')
assert.equal(currentTeam('개미네사업본부'), '개미네')
assert.equal(currentTeam('A/S팀'), 'A/S팀')
assert.equal(currentTeam(null), '부서 미분류') // 빈 부서 행이 있어도 화면이 멈추지 않게
assert.deepEqual(dbTeams(['영업2팀']), ['영업2팀', '화장품사업팀', '해외영업팀'])
assert.deepEqual(dbTeams(['개미네']), ['개미네', '개미네사업본부'])
assert.deepEqual([currentTeam('영업운영팀(HCL)'), hqOf('HCL 영업운영팀').hq], ['HCL 영업운영팀', 'HCL사업본부'])
assert.deepEqual([hqOf('영업3팀').hq, hqOf('개미네').hq, hqOf('A/S팀').hq], ['유통사업본부', '개미네사업본부', '기타'])
{
  const t2 = buildTree(toCurrentTeams([[['유통사업팀'], '2026-02', 1, 100, 60, 40, 100], [['영업1팀'], '2026-06', 1, 50, 30, 20, 50]], ['sales_team']), '')
  assert.equal(t2.children.length, 1)
  assert.equal(t2.children[0].label, '영업1팀')
  assert.equal(t2.children[0].total.supply, 150)
}
assert.equal(p('dairy').items?.length, 2)
// 점유율 차트 부서 클릭: 거래처 행 + 부서 필터, 비상품도 포함 (KPI 기준)
assert.deepEqual(toParams({ ...presetCfg(PRESETS.find((x) => x.id === 'team-customer')), teams: ['영업1팀'] }, '2026-10', '2026-10'), {
  rows: ['customer_name'], from: '2026-10', to: '2026-10', exclude: undefined, channel: undefined, teams: ['영업1팀', '유통사업팀'], items: undefined, sources: undefined,
})
// 기본값 = 전체 포함 (KPI 기준)
assert.deepEqual(toParams(presetCfg(undefined), '', ''), {
  rows: ['sales_team', 'item_category'], from: null, to: null, exclude: undefined, channel: undefined, teams: null, items: undefined, sources: undefined,
})

// 트리: 소계·총계 누적, 이익률 = 이익 ÷ 원가반영매출, 검색은 행 이름 기준
const rows: PivotRow[] = [
  [['영업1팀', 'A마트'], '2026-09', 10, 1000, 600, 400, 1000],
  [['영업1팀', 'B유통'], '2026-09', 5, 500, null, null, null], // 원가 없음
  [['영업1팀', 'A마트'], '2026-10', 1, 100, 50, 50, 100],
  [['영업2팀', 'C카페'], '2026-10', 2, 2000, 1000, 1000, 2000],
]
const t = buildTree(rows, '')
assert.equal(t.total.supply, 3600)
assert.equal(t.children[0].label, '영업2팀') // 판매금액 큰 순
const team1 = t.children[1]
assert.equal(team1.total.supply, 1600)
assert.equal(team1.cells.get('2026-09')!.supply, 1500)
assert.equal(value(team1.total, 'rate'), 450 / 1100)
assert.equal(value(undefined, 'supply'), null)
const found = buildTree(rows, 'a마트')
assert.equal(found.total.supply, 1100)
assert.equal(found.children.length, 1)

// 일 단위 기간: 월 경계면 기존 월 인자만, 월 중간이면 일자 인자 추가
assert.equal(lastDay('2024-02'), '2024-02-29')
assert.equal(lastDay('2026-12'), '2026-12-31')
{
  const c = presetCfg(undefined)
  const whole = toParams(c, '2026-01-01', '2026-10-31')
  assert.deepEqual([whole.from, whole.to, 'dateFrom' in whole, 'dateTo' in whole], ['2026-01', '2026-10', false, false])
  const mid = toParams(c, '2026-01-15', '2026-02-10')
  assert.deepEqual([mid.from, mid.to, mid.dateFrom, mid.dateTo], ['2026-01', '2026-02', '2026-01-15', '2026-02-10'])
}
// 유통본부 팀별 상위품목: 부서 > 품명, 팀은 모두, 팀 아래 품목은 상위 N개만
{
  const pr = presetCfg(PRESETS.find((x) => x.id === 'retail-item'))
  assert.deepEqual([pr.rows, pr.top], [['sales_team', 'item_name'], 5])
  const many: PivotRow[] = Array.from({ length: 7 }, (_, i) => [['영업1팀', `품목${i}`], '2026-10', 1, 100 - i, 0, 0, 0] as PivotRow)
  many.push([['영업2팀', 'X'], '2026-10', 1, 5, 0, 0, 0])
  const tt = buildTree(many, '')
  const keys = new Set(tt.children.map((c) => c.key))
  assert.deepEqual(flatten(tt, keys, 5).map((n) => n.label), ['영업1팀', '품목0', '품목1', '품목2', '품목3', '품목4', '영업2팀', 'X'])
  assert.equal(flatten(tt, keys).length, 10) // 전체보기: 팀 2 + 품목 8
  assert.equal(tt.children[0].total.supply, 679) // 팀 합계는 전체 품목 기준
}
// 연도 접기: 연 합계 = 그 해 월 칸 합
{
  const yt = buildTree([[['A'], '2024-01', 1, 10, 5, 5, 10], [['A'], '2024-12', 1, 20, 5, 15, 20], [['A'], '2025-01', 1, 7, 0, 7, 7]], '')
  assert.equal(sumCells(yt, ['2024-01', '2024-02', '2024-12'])!.supply, 30)
  assert.equal(sumCells(yt, ['2023-05']), undefined)
}
console.log('check-pivot: ok')
