import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  Boxes,
  Building2,
  LogOut,
  CalendarDays,
  Coins,
  Package,
  Percent,
  RefreshCw,
  Table as TableIcon,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import {
  getMonthlyChannelSales,
  getMonthlyCustomerSales,
  getMonthlyItemSales,
  getMonthlyTeamSales,
  getLastLoadedAt,
  getSalesTargets,
  supabase,
  type SalesTarget,
  type ChannelSalesRow,
  type CustomerSalesRow,
  type ItemSalesRow,
  type TeamSalesRow,
} from './lib/supabase'
import { fmtCompact, fmtNumber, fmtPct, fmtWon, monthLabel, rate } from './lib/format'
import { DataTable, type Column } from './components/DataTable'
import { PivotView } from './components/PivotView'
import { RunButton } from './components/RunButton'

interface Dataset {
  team: TeamSalesRow[]
  channel: ChannelSalesRow[]
  item: ItemSalesRow[]
  customer: CustomerSalesRow[]
  targets: SalesTarget[]
}

interface Totals {
  supply: number
  costedSupply: number // 원가 반영 매출: 매출이익 = costedSupply - cost
  cost: number
  profit: number
  qty: number
}

interface TeamSummary extends Totals {
  sales_team: string
  rate: number | null
  share: number
  target: number | null // 매출목표 (실적이 있는 월만 합산)
  achieve: number | null // 달성률 = 매출액 ÷ 매출목표
}

interface ItemSummary extends Totals {
  item_name: string
  item_code: string
  item_type: string
  rate: number | null
  unit_price: number
}

interface CustomerSummary extends Totals {
  customer_name: string
  sales_team: string
  rate: number | null
}

type Tab = 'team' | 'item' | 'customer' | 'pivot'

const ALL = 'all'
const PALETTE = ['#3182f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#94a3b8']
const tooltipStyle = {
  background: '#ffffff',
  border: '1px solid #e5e8eb',
  borderRadius: 12,
  color: '#191f28',
}

function sum(rows: { total_supply_amount: number; costed_supply_amount: number; total_cost: number; total_profit: number; total_qty: number }[]): Totals {
  return rows.reduce(
    (acc, r) => ({
      supply: acc.supply + r.total_supply_amount,
      costedSupply: acc.costedSupply + r.costed_supply_amount,
      cost: acc.cost + r.total_cost,
      profit: acc.profit + r.total_profit,
      qty: acc.qty + r.total_qty,
    }),
    { supply: 0, costedSupply: 0, cost: 0, profit: 0, qty: 0 },
  )
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = map.get(k)
    if (list) list.push(r)
    else map.set(k, [r])
  }
  return map
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [month, setMonth] = useState(ALL)
  const [team, setTeam] = useState(ALL)
  const [tab, setTab] = useState<Tab>('team')
  const pivotMonths = useMemo(() => [...new Set((data?.team ?? []).map((r) => r.sales_month))].sort(), [data])
  const pivotTeams = useMemo(
    () => [...new Set((data?.team ?? []).map((r) => r.sales_team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [data],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [teamRows, channel, item, customer, targets, lastLoaded] = await Promise.all([
        getMonthlyTeamSales(),
        getMonthlyChannelSales(),
        getMonthlyItemSales(),
        getMonthlyCustomerSales(),
        getSalesTargets(),
        getLastLoadedAt(),
      ])
      setData({ team: teamRows, channel, item, customer, targets })
      setLoadedAt(lastLoaded)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const months = useMemo(() => [...new Set(data?.team.map((r) => r.sales_month))].sort(), [data])
  const teams = useMemo(
    () => [...new Set(data?.team.map((r) => r.sales_team))].sort((a, b) => a.localeCompare(b, 'ko')),
    [data],
  )

  const inMonth = useCallback((r: { sales_month: string }) => month === ALL || r.sales_month === month, [month])
  const inTeam = useCallback((r: { sales_team: string }) => team === ALL || r.sales_team === team, [team])

  const kpi = useMemo(() => sum(data?.team.filter((r) => inMonth(r) && inTeam(r)) ?? []), [data, inMonth, inTeam])

  // 월별 추이는 기간 필터와 무관하게 전체 월을 보여주고, 선택 월만 강조
  const trend = useMemo(() => {
    const byMonth = groupBy(data?.team.filter(inTeam) ?? [], (r) => r.sales_month)
    return months.map((m) => {
      const t = sum(byMonth.get(m) ?? [])
      return { month: m, label: monthLabel(m), supply: t.supply, profit: t.profit, rate: rate(t.profit, t.costedSupply) }
    })
  }, [data, months, inTeam])

  const teamSummary = useMemo<TeamSummary[]>(() => {
    const rows = data?.team.filter(inMonth) ?? []
    const grand = sum(rows).supply
    // 전체 기간이면 실적이 있는 월(1월~당월)의 목표만 합산: 아직 안 온 달 목표까지 넣으면 달성률이 의미 없음
    const targetOf = new Map<string, number>()
    for (const t of data?.targets ?? []) {
      if (inMonth({ sales_month: t.target_month }) && months.includes(t.target_month))
        targetOf.set(t.sales_team, (targetOf.get(t.sales_team) ?? 0) + t.target_amount)
    }
    return [...groupBy(rows, (r) => r.sales_team)].map(([name, list]) => {
      const t = sum(list)
      const target = targetOf.get(name) ?? null
      return {
        sales_team: name, ...t, rate: rate(t.profit, t.costedSupply), share: grand ? (t.supply / grand) * 100 : 0,
        target, achieve: target ? (t.supply / target) * 100 : null,
      }
    })
  }, [data, inMonth, months])

  const teamPie = useMemo(() => {
    const sorted = [...teamSummary].sort((a, b) => b.supply - a.supply)
    const head = sorted.slice(0, 7).map((t) => ({ name: t.sales_team, value: t.supply }))
    const rest = sorted.slice(7).reduce((s, t) => s + t.supply, 0)
    return rest > 0 ? [...head, { name: '기타', value: rest }] : head
  }, [teamSummary])

  const regions = useMemo(() => {
    const rows = data?.channel.filter((r) => inMonth(r) && inTeam(r)) ?? []
    return [...groupBy(rows, (r) => r.region || '미지정')]
      .map(([name, list]) => ({ name, value: sum(list).supply }))
      .sort((a, b) => b.value - a.value)
  }, [data, inMonth, inTeam])

  const topItems = useMemo<ItemSummary[]>(() => {
    const rows = data?.item.filter(inMonth) ?? []
    return [...groupBy(rows, (r) => `${r.item_code}|${r.item_name}`)]
      .map(([, list]) => {
        const t = sum(list)
        return {
          item_name: list[0].item_name,
          item_code: list[0].item_code,
          item_type: list[0].item_type ?? '',
          ...t,
          rate: rate(t.profit, t.costedSupply),
          unit_price: t.qty ? t.supply / t.qty : 0,
        }
      })
      .sort((a, b) => b.supply - a.supply)
      .slice(0, 30)
  }, [data, inMonth])

  const topCustomers = useMemo<CustomerSummary[]>(() => {
    const rows = data?.customer.filter((r) => inMonth(r) && inTeam(r)) ?? []
    return [...groupBy(rows, (r) => r.customer_name)]
      .map(([name, list]) => {
        const t = sum(list)
        const teamsOf = [...new Set(list.map((r) => r.sales_team))]
        return { customer_name: name, sales_team: teamsOf.join(', '), ...t, rate: rate(t.profit, t.costedSupply) }
      })
      .sort((a, b) => b.supply - a.supply)
      .slice(0, 30)
  }, [data, inMonth, inTeam])

  const kpiCards = [
    { label: '총 매출액', value: fmtWon(kpi.supply), sub: fmtCompact(kpi.supply) + '원', icon: Wallet, tone: 'blue' },
    { label: '총 원가', value: fmtWon(kpi.cost), sub: `원가 반영 매출 ${fmtCompact(kpi.costedSupply)}원`, icon: Coins, tone: 'violet' },
    { label: '총 매출이익', value: fmtWon(kpi.profit), sub: fmtCompact(kpi.profit) + '원', icon: TrendingUp, tone: 'green' },
    { label: '전체 이익률', value: fmtPct(rate(kpi.profit, kpi.costedSupply)), sub: '매출이익 ÷ 원가 반영 매출', icon: Percent, tone: 'amber' },
    { label: '총 수량', value: fmtNumber(kpi.qty), sub: '판매수량 합계', icon: Boxes, tone: 'cyan' },
  ]

  const periodLabel = month === ALL ? '전체 기간' : `${month.slice(0, 4)}년 ${monthLabel(month)}`

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <BarChart3 size={20} />
          </div>
          <div>
            <h1>매출 실적 대시보드</h1>
            <p className="muted small">
              {periodLabel} · {team === ALL ? '전체 부서' : team}
              {loadedAt &&
                ` · ${loadedAt.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} DB적재`}
            </p>
          </div>
        </div>
        <div className="filters glass">
          <label className="select">
            <CalendarDays size={15} />
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value={ALL}>전체 기간</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m.slice(0, 4)}년 {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="select">
            <Building2 size={15} />
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value={ALL}>전체 부서</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={load} disabled={loading} title="새로고침">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            <span>새로고침</span>
          </button>
          <RunButton onDone={load} />
          <button className="btn ghost" onClick={() => supabase.auth.signOut()} title="로그아웃">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {error && (
        <div className="alert glass">
          데이터를 불러오지 못했습니다: {error}
          <button className="btn" onClick={load}>
            다시 시도
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="loading">
          <RefreshCw size={28} className="spin" />
          <p className="muted">데이터를 불러오는 중…</p>
        </div>
      ) : (
        <main className={loading ? 'refreshing' : ''}>
          <section className="kpis">
            {kpiCards.map(({ label, value, sub, icon: Icon, tone }, i) => (
              <div key={label} className={`kpi glass tone-${tone}`} style={{ animationDelay: `${i * 60}ms` }}>
                <div className="kpi-head">
                  <span className="muted">{label}</span>
                  <span className="kpi-icon">
                    <Icon size={17} />
                  </span>
                </div>
                <div className="kpi-value">{value}</div>
                <div className="muted small">{sub}</div>
              </div>
            ))}
          </section>

          <section className="charts">
            <div className="card glass span-2">
              <div className="card-head">
                <h2>월별 매출 추이</h2>
                <span className="muted small">막대: 매출액 · 선: 매출이익</span>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3182f6" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#3182f6" stopOpacity={0.45} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eef0f3" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748b" tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={56} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: 'rgba(49,130,246,0.06)' }}
                    formatter={(v, name) => [fmtWon(Number(v)), name === 'supply' ? '매출액' : '매출이익']}
                  />
                  <Bar dataKey="supply" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {trend.map((t) => (
                      <Cell
                        key={t.month}
                        fill="url(#barGrad)"
                        fillOpacity={month === ALL || month === t.month ? 1 : 0.3}
                      />
                    ))}
                  </Bar>
                  <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="card glass">
              <div className="card-head">
                <h2>부서별 매출 점유율</h2>
                <span className="muted small">{periodLabel}</span>
              </div>
              <div className="pie-wrap">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={teamPie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={58}
                      outerRadius={90}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {teamPie.map((d, i) => (
                        <Cell
                          key={d.name}
                          fill={PALETTE[i % PALETTE.length]}
                          fillOpacity={team === ALL || team === d.name ? 1 : 0.25}
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtWon(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="legend">
                  {teamPie.map((d, i) => {
                    const total = teamPie.reduce((s, x) => s + x.value, 0)
                    return (
                      <li key={d.name}>
                        <i style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="legend-name">{d.name}</span>
                        <span className="muted">{total ? ((d.value / total) * 100).toFixed(1) : 0}%</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>

            <div className="card glass">
              <div className="card-head">
                <h2>권역별 매출 분포</h2>
                <span className="muted small">{team === ALL ? '전체 부서' : team}</span>
              </div>
              <ResponsiveContainer width="100%" height={Math.max(200, regions.length * 44)}>
                <BarChart data={regions} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#eef0f3" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
                  <YAxis type="category" dataKey="name" stroke="#64748b" tickLine={false} axisLine={false} width={72} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: 'rgba(139,92,246,0.06)' }}
                    formatter={(v) => [fmtWon(Number(v)), '매출액']}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={26}>
                    {regions.map((r) => (
                      <Cell key={r.name} fill={r.name === '미지정' ? '#cbd5e1' : '#8b5cf6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card glass">
            <nav className="tabs">
              <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>
                <Building2 size={15} /> 부서별 실적
              </button>
              <button className={tab === 'item' ? 'active' : ''} onClick={() => setTab('item')}>
                <Package size={15} /> 베스트 품목 TOP 30
              </button>
              <button className={tab === 'customer' ? 'active' : ''} onClick={() => setTab('customer')}>
                <Users size={15} /> 주요 거래처 TOP 30
              </button>
              <button className={tab === 'pivot' ? 'active' : ''} onClick={() => setTab('pivot')}>
                <TableIcon size={15} /> 조회 (시트 피벗)
              </button>
            </nav>
            <div className="tab-body" key={tab}>
              {tab === 'team' && (
                <DataTable rows={teamSummary} columns={teamColumns(team)} searchKeys={['sales_team']} defaultSort="supply" />
              )}
              {tab === 'item' && (
                <DataTable
                  rows={topItems}
                  columns={itemColumns}
                  searchKeys={['item_name', 'item_code', 'item_type']}
                  defaultSort="supply"
                  rank
                  note={team === ALL ? undefined : '품목 집계에는 부서 필터가 적용되지 않습니다'}
                />
              )}
              {tab === 'pivot' && <PivotView months={pivotMonths} teams={pivotTeams} />}
              {tab === 'customer' && (
                <DataTable
                  rows={topCustomers}
                  columns={customerColumns}
                  searchKeys={['customer_name', 'sales_team']}
                  defaultSort="supply"
                  rank
                />
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

const money = <T extends Totals>(key: keyof Totals) => (r: T) => fmtWon(r[key])
const pct = <T extends { rate: number | null }>(r: T) => (
  <span className={r.rate !== null && r.rate < 0 ? 'neg' : ''}>{fmtPct(r.rate)}</span>
)

function teamColumns(selected: string): Column<TeamSummary>[] {
  return [
    {
      key: 'sales_team',
      label: '부서',
      render: (r) => <span className={r.sales_team === selected ? 'highlight' : ''}>{r.sales_team}</span>,
    },
    { key: 'supply', label: '매출액', align: 'right', render: money('supply') },
    { key: 'target', label: '매출목표', align: 'right', render: (r) => (r.target === null ? <span className="dim">-</span> : fmtWon(r.target)) },
    { key: 'achieve', label: '달성률', align: 'right', render: (r) => fmtPct(r.achieve) },
    { key: 'costedSupply', label: '원가 반영 매출', align: 'right', render: money('costedSupply') },
    { key: 'cost', label: '원가', align: 'right', render: money('cost') },
    { key: 'profit', label: '매출이익', align: 'right', render: money('profit') },
    { key: 'rate', label: '이익률', align: 'right', render: pct },
    { key: 'qty', label: '수량', align: 'right', render: (r) => fmtNumber(r.qty) },
    {
      key: 'share',
      label: '점유율',
      align: 'right',
      render: (r) => (
        <span className="share">
          <span className="share-bar" style={{ width: `${Math.min(100, r.share)}%` }} />
          {r.share.toFixed(1)}%
        </span>
      ),
    },
  ]
}

const itemColumns: Column<ItemSummary>[] = [
  { key: 'item_name', label: '품목명' },
  { key: 'item_code', label: '품목코드', render: (r) => r.item_code || <span className="dim">-</span> },
  { key: 'item_type', label: '분류' },
  { key: 'supply', label: '매출액', align: 'right', render: money('supply') },
  { key: 'profit', label: '매출이익', align: 'right', render: money('profit') },
  { key: 'rate', label: '이익률', align: 'right', render: pct },
  { key: 'qty', label: '수량', align: 'right', render: (r) => fmtNumber(r.qty) },
  { key: 'unit_price', label: '평균단가', align: 'right', render: (r) => fmtWon(r.unit_price) },
]

const customerColumns: Column<CustomerSummary>[] = [
  { key: 'customer_name', label: '거래처명' },
  { key: 'sales_team', label: '담당 부서' },
  { key: 'supply', label: '매출액', align: 'right', render: money('supply') },
  { key: 'costedSupply', label: '원가 반영 매출', align: 'right', render: money('costedSupply') },
  { key: 'cost', label: '원가', align: 'right', render: money('cost') },
  { key: 'profit', label: '매출이익', align: 'right', render: money('profit') },
  { key: 'rate', label: '이익률', align: 'right', render: pct },
  { key: 'qty', label: '수량', align: 'right', render: (r) => fmtNumber(r.qty) },
]
