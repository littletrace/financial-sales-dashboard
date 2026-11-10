// 조회 탭 피벗: 프리셋 정의 + 조건 → RPC 파라미터 + 트리 집계 (React 없이 점검 가능: scripts/check-pivot.ts)
import type { PivotParams, PivotRow } from './supabase'
import { HQ, currentTeam, dbTeams } from './teams.ts'

export type Field =
  | 'sales_team' | 'customer_name' | 'item_category' | 'item_type' | 'item_name' | 'region' | 'channel_type' | 'sales_source'
export type Measure = 'supply' | 'qty' | 'cost' | 'profit' | 'rate'
export type ExMode = 'none' | 'base' | 'ext'
export type ColMode = 'month' | 'measure'

export const FIELD_LABEL: Record<Field, string> = {
  sales_team: '부서',
  customer_name: '거래처',
  item_category: '품목자산분류',
  item_type: '품목소분류',
  item_name: '품명',
  region: '권역',
  channel_type: '영업점구분',
  sales_source: '출처',
}
export const MEASURE_LABEL: Record<Measure, string> = {
  supply: '판매금액', qty: '수량', cost: '매출원가', profit: '매출이익', rate: '이익률',
}
export const COST_MEASURES = new Set<Measure>(['cost', 'profit', 'rate'])

// 비상품 제외: base = 구 조회4~7, ext = 구 조회3 (a/s부품·원자재까지)
export const EX_CATEGORIES: Record<ExMode, string[]> = {
  none: [],
  base: ['운송비', '소모품', '서비스'],
  ext: ['운송비', '소모품', '서비스', 'a/s부품', '원자재'],
}
export const RETAIL = HQ.find(([h]) => h === '유통사업본부')![1] // 유통사업본부 소속 (lib/teams.ts)
const DAIRY = ['와일드오차드 스트링치즈150g', '와일드오차드 유기농우유 900ml']

export interface Cfg {
  rows: Field[]
  src: 'all' | '국내' | '수출'
  ch: 'all' | '영업점'
  teams: string[]
  ex: ExMode
  items: string[]
  col: ColMode
  measure: Measure
  top: number // 0 = 전체. N이면 상위 행 아래 하위 행을 판매금액 상위 N개만 (전체보기로 해제)
}
// 기본값 = KPI와 같은 기준(전체 포함)
export const DEFAULT_CFG: Cfg = {
  rows: ['sales_team', 'item_category'], src: 'all', ch: 'all', teams: [], ex: 'none', items: [], col: 'month', measure: 'supply', top: 0,
}

export interface Preset extends Partial<Cfg> {
  id: string
  group: string
  name: string
  rows: Field[]
  old?: string // 구 시트 피벗 이름 (툴팁용)
}
export const PRESETS: Preset[] = [
  { group: '부서', id: 'team', name: '부서별 매출', rows: ['sales_team'], ex: 'ext', old: '조회3' },
  { group: '부서', id: 'team-customer', name: '부서 거래처별 매출·원가', rows: ['customer_name'], col: 'measure' },
  { group: '부서', id: 'team-store', name: '부서별 영업점별 매출', rows: ['sales_team', 'item_category', 'customer_name'], ex: 'base', src: '국내', ch: '영업점', old: '조회5' },
  { group: '영업점', id: 'store', name: '영업점별 매출·원가', rows: ['customer_name', 'item_category'], ex: 'base', src: '국내', ch: '영업점', col: 'measure', old: '조회4' },
  { group: '품목', id: 'retail-item', name: '유통본부 팀별 상위품목', rows: ['sales_team', 'item_name'], ex: 'base', src: '국내', teams: RETAIL, top: 5 },
  { group: '품목', id: 'dairy', name: '유제품', rows: ['item_name', 'customer_name'], items: DAIRY, measure: 'qty', old: '유제품' },
  { group: '권역', id: 'region-team', name: '권역별 부서 매출', rows: ['region', 'sales_team'] },
  { group: '권역', id: 'region-customer', name: '권역별 거래처 매출', rows: ['region', 'customer_name'] },
]

export function presetCfg(p: Preset | undefined): Cfg {
  const c = structuredClone(DEFAULT_CFG)
  if (!p) return c
  for (const k of Object.keys(c) as (keyof Cfg)[]) if (p[k] !== undefined) (c as unknown as Record<string, unknown>)[k] = structuredClone(p[k])
  return c
}

// 해당 월 말일 (YYYY-MM → YYYY-MM-DD)
export const lastDay = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10)

// from/to: YYYY-MM 또는 YYYY-MM-DD. 월 경계가 아닌 날짜일 때만 일자 조건을 보냄 (월 단위는 기존 RPC 인자 그대로)
export function toParams(c: Cfg, from: string, to: string): PivotParams {
  const dateFrom = from.length > 7 && !from.endsWith('-01') ? from : undefined
  const dateTo = to.length > 7 && to !== lastDay(to.slice(0, 7)) ? to : undefined
  return {
    rows: c.rows,
    from: from.slice(0, 7) || null,
    to: to.slice(0, 7) || null,
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    exclude: c.ex === 'none' ? undefined : EX_CATEGORIES[c.ex],
    channel: c.ch === 'all' ? undefined : c.ch,
    teams: c.teams.length ? dbTeams(c.teams) : null, // 현재 부서 → DB의 옛 부서명까지
    items: c.items.length ? c.items : undefined,
    sources: c.src === 'all' ? undefined : [c.src],
  }
}

/** DB 결과의 옛 부서명을 현재 부서로 바꿈 (같은 경로는 buildTree에서 합쳐짐) */
export function toCurrentTeams(rows: PivotRow[], fields: Field[]): PivotRow[] {
  const i = fields.indexOf('sales_team')
  if (i < 0) return rows
  return rows.map(([keys, ...rest]) => [keys.map((k, j) => (j === i ? currentTeam(k) : k)), ...rest] as PivotRow)
}

// ---------- 트리 집계 ----------
export interface Agg { qty: number; supply: number; cost: number; profit: number; costed: number }
export interface Node {
  key: string
  label: string
  depth: number
  cells: Map<string, Agg> // 월별
  total: Agg
  children: Node[]
}
const zero = (): Agg => ({ qty: 0, supply: 0, cost: 0, profit: 0, costed: 0 })
function add(a: Agg, r: PivotRow) {
  a.qty += Number(r[2] ?? 0)
  a.supply += Number(r[3] ?? 0)
  a.cost += Number(r[4] ?? 0)
  a.profit += Number(r[5] ?? 0)
  a.costed += Number(r[6] ?? 0)
}
function addCell(n: Node, r: PivotRow) {
  let a = n.cells.get(r[1])
  if (!a) n.cells.set(r[1], (a = zero()))
  add(a, r)
  add(n.total, r)
}

// 여러 월 칸 합계 (연도 접기). 해당 월이 하나도 없으면 undefined
export function sumCells(n: Node, months: string[]): Agg | undefined {
  let a: Agg | undefined
  for (const m of months) {
    const c = n.cells.get(m)
    if (!c) continue
    a ??= zero()
    for (const k of Object.keys(a) as (keyof Agg)[]) a[k] += c[k]
  }
  return a
}

// 이익률 = 매출이익 ÷ 원가 반영 매출 (원가 없는 품목은 분모에서도 빠짐)
export function value(a: Agg | undefined, m: Measure): number | null {
  if (!a) return null
  if (m === 'rate') return a.costed ? a.profit / a.costed : null
  return a[m]
}

// 행키 경로로 트리를 만들고 단계마다 소계를 누적. 검색어는 행 이름 중 하나라도 포함하면 남김(표 안 찾기)
export function buildTree(rows: PivotRow[], query: string): Node {
  const root: Node = { key: '', label: '총계', depth: -1, cells: new Map(), total: zero(), children: [] }
  const index = new Map<string, Node>()
  const q = query.trim().toLowerCase()
  for (const r of rows) {
    const keys = r[0]
    if (q && !keys.some((k) => k.toLowerCase().includes(q))) continue
    let parent = root
    let path = ''
    keys.forEach((k, depth) => {
      path += '\u0001' + k
      let n = index.get(path)
      if (!n) {
        n = { key: path, label: k, depth, cells: new Map(), total: zero(), children: [] }
        index.set(path, n)
        parent.children.push(n)
      }
      addCell(n, r)
      parent = n
    })
    addCell(root, r)
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => b.total.supply - a.total.supply)
    n.children.forEach(sort)
  }
  sort(root)
  return root
}

// top > 0: 최상위 행은 모두, 그 아래는 판매금액 상위 top개만
export function flatten(n: Node, expanded: Set<string>, top = 0, out: Node[] = []): Node[] {
  for (const c of top && n.depth >= 0 ? n.children.slice(0, top) : n.children) {
    out.push(c)
    if (expanded.has(c.key)) flatten(c, expanded, top, out)
  }
  return out
}

export function allParents(n: Node, out: string[] = []): string[] {
  for (const c of n.children) {
    if (c.children.length) {
      out.push(c.key)
      allParents(c, out)
    }
  }
  return out
}
