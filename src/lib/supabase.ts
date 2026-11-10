import { createClient } from '@supabase/supabase-js'

// anon 키는 브라우저 공개용 키이며, 실제 접근 제어는 Supabase RLS가 담당한다.
// 데이터 읽기는 로그인 + app_metadata.role 이 있는 사용자만 허용 (DB 정책 dashboard_role()).
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://yggjkllldhhvfvcnsgko.supabase.co'
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlnZ2prbGxsZGhodmZ2Y25zZ2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTU3NzEsImV4cCI6MjEwNDkzMTc3MX0.kV9uuUmjEW4R7ImEsuySYwwO-vB1HcYpGAHyV5J4c7k'

// 로그인 세션은 탭을 닫으면 사라지게 sessionStorage 에 둔다 (새로고침은 유지, 새 탭·재접속은 다시 로그인)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: sessionStorage } })

// 예전 버전이 localStorage 에 남긴 로그인 토큰 정리 (남아 있으면 PC에 리프레시 토큰이 계속 남음)
try {
  for (const k of Object.keys(localStorage)) if (/^sb-.+-auth-token$/.test(k)) localStorage.removeItem(k)
} catch {
  /* 저장소 접근 불가 환경 무시 */
}

// Supabase Auth 는 이메일 기반이라 아이디를 고정 도메인 이메일로 바꿔 로그인한다 (test → test@dashboard.local)
const LOGIN_DOMAIN = 'dashboard.local'
export const toLoginEmail = (id: string) => {
  const v = id.trim().toLowerCase()
  return v.includes('@') ? v : `${v}@${LOGIN_DOMAIN}`
}

export interface SalesMetrics {
  total_qty: number
  total_supply_amount: number
  total_cost: number
  total_profit: number
  profit_rate: number | null
  costed_supply_amount: number // 원가가 있는 행의 매출액
  provisional_supply_amount: number // 가결산 매출: 원가 미확정 월에 품목별 최근 원가를 쓴 행
  provisional_profit: number // 가결산 매출이익
  set_estimated_supply_amount: number // 세트추정 매출: 원가 이력 없는 세트를 구성품 원가 합으로 추정한 행
  set_estimated_profit: number
  purchase_estimated_supply_amount: number // 구매가추정 매출: 원가 이력 없는 품목을 구매단가로 추정한 행
  purchase_estimated_profit: number
}

export interface TeamSalesRow extends SalesMetrics {
  sales_month: string
  sales_team: string
  row_count: number
}

export interface ItemSalesRow extends SalesMetrics {
  sales_month: string
  item_type: string | null
  item_category: string | null
  item_name: string
  item_code: string
  avg_unit_price: number | null
  cost_month: string | null // 적용 원가월 (가결산이면 이전 월)
}

// 마지막 DB 적재 시각: 적재 스크립트가 매번 전 기간을 재계산하며 updated_at 을 갱신함
export async function getLastLoadedAt(): Promise<Date | null> {
  const { data, error } = await supabase
    .from('fct_sales')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return data?.[0] ? new Date(data[0].updated_at) : null
}

export interface CustomerSalesRow extends SalesMetrics {
  sales_month: string
  sales_team: string
  customer_name: string
  row_count: number
}

const NUMERIC_KEYS = [
  'row_count',
  'total_qty',
  'total_supply_amount',
  'total_cost',
  'total_profit',
  'profit_rate',
  'avg_unit_price',
  'costed_supply_amount',
  'provisional_supply_amount',
  'provisional_profit',
  'set_estimated_supply_amount',
  'set_estimated_profit',
  'purchase_estimated_supply_amount',
  'purchase_estimated_profit',
] as const

// PostgREST 응답의 numeric 컬럼을 number로 정규화
function normalize<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...row }
  for (const key of NUMERIC_KEYS) {
    if (key in out && out[key] !== null) out[key] = Number(out[key])
  }
  return out as T
}

const PAGE_SIZE = 1000

// PostgREST 기본 max-rows(1000) 제한을 넘는 View를 페이지 단위로 전부 조회.
// 페이지 경계에서 행이 중복/누락되지 않도록 View의 GROUP BY 키 전체로 정렬한다.
async function fetchAll<T>(view: string, orderKeys: string[]): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(view).select('*')
    for (const key of orderKeys) query = query.order(key, { ascending: true, nullsFirst: true })
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`[${view}] ${error.message}`)
    rows.push(...(data ?? []).map((r) => normalize<T>(r)))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

export interface SalesTarget {
  target_month: string
  sales_team: string
  target_amount: number // 부가세 별도
}

// 부서별 월별 매출목표 (기준표/매출목표.csv, 연 100행 미만이라 한 번에 조회)
export async function getSalesTargets(): Promise<SalesTarget[]> {
  const { data, error } = await supabase.from('dim_sales_target').select('target_month,sales_team,target_amount')
  if (error) throw new Error(`[dim_sales_target] ${error.message}`)
  return (data ?? []).map((r) => ({ ...r, target_amount: Number(r.target_amount) }))
}

// 영림원 손익계산서(월별) 계정레벨 1. 판관비는 부서 배분 기준이 없어 dept='전체' 만 있음
export interface PlRow {
  pl_month: string
  account_name: string // 매출액 / 매출원가 / 매출총이익 / 판매비와 관리비 / 영업이익
  amount: number
}

export async function getPlMonthly(): Promise<PlRow[]> {
  const { data, error } = await supabase.from('fct_pl_monthly').select('pl_month,account_name,amount').eq('dept', '전체')
  if (error) throw new Error(`[fct_pl_monthly] ${error.message}`)
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }))
}

export const getMonthlyTeamSales = () =>
  fetchAll<TeamSalesRow>('v_sales_monthly_team', ['sales_month', 'sales_team'])

export const getMonthlyItemSales = () =>
  fetchAll<ItemSalesRow>('v_sales_monthly_item', ['sales_month', 'item_type', 'item_category', 'item_name', 'item_code'])

export const getMonthlyCustomerSales = () =>
  fetchAll<CustomerSalesRow>('v_sales_monthly_customer', ['sales_month', 'sales_team', 'customer_name'])

// ---------- 조회(피벗): 구글시트 조회 탭 대체 ----------
// 행 하나 = [행키배열, 월, 수량, 판매금액, 원가, 이익, 원가반영매출]
export type PivotRow = [string[], string, number | null, number | null, number | null, number | null, number | null]

export interface PivotParams {
  rows: string[]
  from?: string | null
  to?: string | null
  exclude?: string[] | null // 제외할 품목자산분류 ('(빈값)' = 비어 있는 행)
  channel?: string | null
  teams?: string[] | null
  items?: string[] | null
  sources?: string[] | null // 국내 / 수출
  dateFrom?: string // YYYY-MM-DD, 월 중간부터 볼 때만 (DB migration_20261110_pivot_date_range 필요)
  dateTo?: string
}

export async function getPivot(p: PivotParams): Promise<PivotRow[]> {
  const { data, error } = await supabase.rpc('pivot_sales', {
    p_rows: p.rows,
    p_from: p.from ?? null,
    p_to: p.to ?? null,
    p_exclude_categories: p.exclude ?? null,
    p_channel: p.channel ?? null,
    p_teams: p.teams ?? null,
    p_items: p.items ?? null,
    p_sources: p.sources ?? null,
    ...(p.dateFrom && { p_date_from: p.dateFrom }),
    ...(p.dateTo && { p_date_to: p.dateTo }),
  })
  if (error) throw new Error(`[pivot_sales] ${error.message}`)
  return (data ?? []) as PivotRow[]
}

// ---------- 재고: 장기재고 · 유통기한 (finance-db-loader py/load_stock.py 가 매번 전체 교체) ----------
export interface LongStockRow {
  snapshot_date: string
  item_category: string | null
  item_name: string
  item_code: string | null
  stock_qty: number
  last_in_date: string | null
  last_out_date: string | null
  no_out: boolean // 출고 이력 없음 → 미출고일수는 입고 후 경과일
  idle_days: number | null
  stock_amount: number | null // 최근 재고단가 × 수량 (단가 없으면 null)
}

export interface ExpiryLotRow {
  snapshot_date: string
  item_code: string
  erp_code: string | null
  item_name: string
  expiry_date: string
  qty: number
  shelf_months: number | null
  days_left: number // 오늘(한국시간) 기준
  remain_rate: number | null // 남은 일수 ÷ 유통기간
  amount: number | null
  long_idle_days: number | null // 장기재고면 미출고일수, 아니면 null
}

const nums = <T,>(keys: string[]) => (r: T) => {
  const o = { ...r } as Record<string, unknown>
  for (const k of keys) if (o[k] !== null && o[k] !== undefined) o[k] = Number(o[k])
  return o as T
}

export const getLongStock = async () =>
  (await fetchAll<LongStockRow>('v_long_stock', ['item_code', 'item_name', 'last_in_date', 'stock_qty']))
    .map(nums<LongStockRow>(['stock_qty', 'idle_days', 'stock_amount']))

export const getExpiryLots = async () =>
  (await fetchAll<ExpiryLotRow>('v_expiry_lot', ['item_code', 'expiry_date', 'qty']))
    .map(nums<ExpiryLotRow>(['qty', 'shelf_months', 'days_left', 'remain_rate', 'amount', 'long_idle_days']))
