// 조회 탭 피벗 로직 점검: node scripts/check-pivot.ts
import assert from 'node:assert/strict'
import { PRESETS, buildTree, presetCfg, toCurrentTeams, toParams, value } from '../src/lib/pivot.ts'
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
assert.deepEqual(dbTeams(['영업2팀']), ['영업2팀', '화장품사업팀', '해외영업팀'])
assert.deepEqual(dbTeams(['개미네']), ['개미네', '개미네사업본부'])
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
console.log('check-pivot: ok')
