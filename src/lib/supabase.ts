import { createClient } from '@supabase/supabase-js'

// anon 키는 브라우저 공개용 키이며, 실제 접근 제어는 Supabase RLS가 담당한다.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://yggjkllldhhvfvcnsgko.supabase.co'
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlnZ2prbGxsZGhodmZ2Y25zZ2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTU3NzEsImV4cCI6MjEwNDkzMTc3MX0.kV9uuUmjEW4R7ImEsuySYwwO-vB1HcYpGAHyV5J4c7k'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

export interface SalesMetrics {
  total_qty: number
  total_supply_amount: number
  total_cost: number
  total_profit: number
  profit_rate: number | null
  costed_supply_amount: number // 원가가 있는 행의 매출액
}

export interface TeamSalesRow extends SalesMetrics {
  sales_month: string
  sales_team: string
  row_count: number
}

export interface ChannelSalesRow extends SalesMetrics {
  sales_month: string
  sales_team: string
  channel_type: string
  region: string
  row_count: number
}

export interface ItemSalesRow extends SalesMetrics {
  sales_month: string
  item_type: string | null
  item_category: string | null
  item_name: string
  item_code: string
  avg_unit_price: number | null
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

export const getMonthlyTeamSales = () =>
  fetchAll<TeamSalesRow>('v_sales_monthly_team', ['sales_month', 'sales_team'])

export const getMonthlyChannelSales = () =>
  fetchAll<ChannelSalesRow>('v_sales_monthly_channel', ['sales_month', 'sales_team', 'channel_type', 'region'])

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
  })
  if (error) throw new Error(`[pivot_sales] ${error.message}`)
  return (data ?? []) as PivotRow[]
}
