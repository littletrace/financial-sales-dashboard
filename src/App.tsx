import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  Building2,
  LogOut,
  Smartphone,
  CalendarDays,
  Landmark,
  Package,
  RefreshCw,
  Table as TableIcon,
  Users,
} from 'lucide-react'
import {
  getMonthlyCustomerSales,
  getMonthlyItemSales,
  getMonthlyTeamSales,
  getLastLoadedAt,
  getSalesTargets,
  getPlMonthly,
  supabase,
  type PlRow,
  type SalesTarget,
  type SalesMetrics,
  type CustomerSalesRow,
  type ItemSalesRow,
  type TeamSalesRow,
} from './lib/supabase'
import { fmtCompact, fmtNumber, fmtPct, fmtWon, monthLabel, rate, ymLabel } from './lib/format'
import { DataTable, type Column } from './components/DataTable'
import { PivotView } from './components/PivotView'
import { RunButton } from './components/RunButton'
import { ChatPanel } from './components/ChatPanel'
import { MobileView } from './components/MobileView'
import { TEAM_MERGE, currentTeam, hqOf } from './lib/teams'

// 휴대폰 화면 폭이면 모바일 화면(B안)으로
const NARROW = '(max-width: 640px)'
const subscribeNarrow = (cb: () => void) => {
  const mq = matchMedia(NARROW)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

interface Dataset {
  merged: { month: string; from: string; to: string }[] // 현재 부서로 합쳐 보여주는 옛 부서 매출 (안내 문구용)
  team: TeamSalesRow[]
  item: ItemSalesRow[]
  customer: CustomerSalesRow[]
  targets: SalesTarget[]
  pl: PlRow[]
}

const SGA = '판매비와 관리비'

interface Totals {
  supply: number
  costedSupply: number // 원가 반영 매출: 매출이익 = costedSupply - cost
  cost: number
  profit: number
  qty: number
  provSupply: number // 가결산 매출 (원가 미확정 월)
  provProfit: number // 가결산 매출이익
  setSupply: number // 세트추정 매출 (구성품 원가 합으로 추정)
  setProfit: number
  buySupply: number // 구매가추정 매출 (재고금액상세조회 구매단가로 추정)
  buyProfit: number
}

export interface TeamSummary extends Totals {
  hq: string // 본부 (lib/teams.ts)
  hq_rank: number
  sales_team: string
  rate: number | null
  target: number | null // 매출목표 (실적이 있는 월만 합산)
  targetSupply: number // 목표가 있는 월의 매출 (달성률 분자)
  achieve: number | null // 달성률 = 목표가 있는 월의 매출 ÷ 매출목표
}

export interface ItemSummary extends Totals {
  item_name: string
  item_code: string
  item_type: string
  rate: number | null
  unit_price: number
  costMonth: string | null // 가결산에 쓴 원가월
}

export interface CustomerSummary extends Totals {
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

function sum(rows: SalesMetrics[]): Totals {
  return rows.reduce(
    (acc, r) => ({
      supply: acc.supply + r.total_supply_amount,
      costedSupply: acc.costedSupply + r.costed_supply_amount,
      cost: acc.cost + r.total_cost,
      profit: acc.profit + r.total_profit,
      qty: acc.qty + r.total_qty,
      provSupply: acc.provSupply + r.provisional_supply_amount,
      provProfit: acc.provProfit + r.provisional_profit,
      setSupply: acc.setSupply + r.set_estimated_supply_amount,
      setProfit: acc.setProfit + r.set_estimated_profit,
      buySupply: acc.buySupply + r.purchase_estimated_supply_amount,
      buyProfit: acc.buyProfit + r.purchase_estimated_profit,
    }),
    { supply: 0, costedSupply: 0, cost: 0, profit: 0, qty: 0, provSupply: 0, provProfit: 0, setSupply: 0, setProfit: 0, buySupply: 0, buyProfit: 0 },
  )
}

const THIS_YEAR = String(new Date().getFullYear())
const THIS_MONTH = new Date().toLocaleDateString('sv-SE').slice(0, 7) // 로컬 YYYY-MM

// 부서별 합계 + 매출목표·달성률. inRange: 기간 조건 (상단 기간 또는 올해)
function summarizeTeams(data: Dataset | null, months: string[], inMonth: (r: { sales_month: string }) => boolean): TeamSummary[] {
  const rows = data?.team.filter(inMonth) ?? []
  // 전체 기간이면 실적이 있는 월(1월~당월)의 목표만 합산: 아직 안 온 달 목표까지 넣으면 달성률이 의미 없음
  const targetOf = new Map<string, number>()
  const targetMonths = new Set<string>() // 부서|월: 목표 없는 월(예: 2024~2025)의 매출은 달성률에서 뺌
  for (const t of data?.targets ?? []) {
    if (inMonth({ sales_month: t.target_month }) && months.includes(t.target_month)) {
      targetOf.set(t.sales_team, (targetOf.get(t.sales_team) ?? 0) + t.target_amount)
      targetMonths.add(`${t.sales_team}|${t.target_month}`)
    }
  }
  return [...groupBy(rows, (r) => r.sales_team)].map(([name, list]) => {
    const t = sum(list)
    const target = targetOf.get(name) ?? null
    const targetSupply = list.filter((r) => targetMonths.has(`${name}|${r.sales_month}`)).reduce((a, r) => a + r.total_supply_amount, 0)
    const { hq, rank } = hqOf(name)
    return {
      hq, hq_rank: rank, sales_team: name, ...t, rate: rate(t.profit, t.costedSupply),
      target, targetSupply, achieve: target ? (targetSupply / target) * 100 : null,
    }
  })
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
  // 기간: 전체(ALL) 또는 시작월~끝월 (YYYY-MM). 둘 다 ALL이거나 둘 다 월
  // 기본 기간: 올해 1월 ~ 이번 달 ([전체] 버튼 = 전 기간)
  const [from, setFrom] = useState(`${THIS_YEAR}-01`)
  const [to, setTo] = useState(THIS_MONTH)
  const [team, setTeam] = useState(ALL)
  const [tab, setTab] = useState<Tab>('team')
  // 점유율 차트에서 부서 클릭 → 조회 탭을 그 부서의 거래처별 매출·원가로 열기 (key로 매번 새로 열림)
  // range: 조회 탭 기간 (없으면 상단 기간)
  const [pivotFocus, setPivotFocus] = useState<{ key: number; teams: string[]; range?: { from: string; to: string } } | null>(null)
  const openTeamPivot = (teams: string[], range?: { from: string; to: string }) => {
    setPivotFocus((f) => ({ key: (f?.key ?? 0) + 1, teams, range }))
    setTab('pivot')
    document.getElementById('detail-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const [withSga, setWithSga] = useState(false) // 판관비 포함 보기: 판관비·영업이익 카드 + 영업이익 선
  const narrow = useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches)
  const [pcView, setPcView] = useState(false) // 휴대폰에서 'PC 대시보드 열기'를 누른 경우
  const [withOpen, setWithOpen] = useState(false) // 결산 전 월을 판관비·영업이익 합계에 넣을지 (기본 제외: 판관비가 아직 쌓이는 중)
  const pivotMonths = useMemo(() => [...new Set((data?.team ?? []).map((r) => r.sales_month))].sort(), [data])
  const pivotItems = useMemo(
    () => [...new Set((data?.item ?? []).map((r) => r.item_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [data],
  )
  const pivotTeams = useMemo(
    () => [...new Set((data?.team ?? []).map((r) => r.sales_team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [data],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [teamRows, item, customer, targets, pl, lastLoaded] = await Promise.all([
        getMonthlyTeamSales(),
        getMonthlyItemSales(),
        getMonthlyCustomerSales(),
        getSalesTargets(),
        getPlMonthly(),
        getLastLoadedAt().catch(() => null), // 적재 시각은 표시용: 실패해도 화면은 열림
      ])
      // 부서는 화면에서만 현재 부서로 합침 (DB는 그 달 부서명 그대로)
      const cur = <T extends { sales_team: string }>(rows: T[]) => rows.map((x) => ({ ...x, sales_team: currentTeam(x.sales_team) }))
      const merged = teamRows.filter((x) => TEAM_MERGE[x.sales_team] && x.total_supply_amount !== 0)
        .map((x) => ({ month: x.sales_month, from: x.sales_team, to: TEAM_MERGE[x.sales_team] }))
      setData({ merged, team: cur(teamRows), item, customer: cur(customer), targets: cur(targets), pl })
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
  // 원가 미확정(가결산) 월: 부서 필터와 무관하게 전체 기준으로 판단
  const provMonths = useMemo(
    () => new Set((data?.team ?? []).filter((r) => r.provisional_supply_amount !== 0).map((r) => r.sales_month)),
    [data],
  )
  const inMonth = useCallback((r: { sales_month: string }) => from === ALL || (r.sales_month >= from && r.sales_month <= to), [from, to])
  const provInView = months.filter((m) => provMonths.has(m) && inMonth({ sales_month: m }))
  const teams = useMemo(
    () => [...new Set(data?.team.map((r) => r.sales_team))].sort((a, b) => a.localeCompare(b, 'ko')),
    [data],
  )

  const inTeam = useCallback((r: { sales_team: string }) => team === ALL || r.sales_team === team, [team])

  const kpi = useMemo(() => sum(data?.team.filter((r) => inMonth(r) && inTeam(r)) ?? []), [data, inMonth, inTeam])

  // 판관비: 영림원 손익계산서 월 합계. 부서 배분 기준이 없어 부서 선택 시엔 표시 안 함
  // 영업이익 = DB 매출이익(가결산·추정 포함) - 판관비. 영림원 매출원가가 0인 월 = 결산 전 (판관비도 진행 중일 수 있음)
  const sgaOf = useMemo(() => new Map((data?.pl ?? []).filter((r) => r.account_name === SGA).map((r) => [r.pl_month, r.amount])), [data])
  const openMonths = useMemo(
    () => new Set((data?.pl ?? []).filter((r) => r.account_name === '매출원가' && r.amount === 0).map((r) => r.pl_month)),
    [data],
  )
  const openInView = months.filter((m) => inMonth({ sales_month: m }) && sgaOf.has(m) && openMonths.has(m))
  const sga = useMemo(() => {
    if (!withSga || team !== ALL) return null
    const ms = months.filter((m) => inMonth({ sales_month: m }) && sgaOf.has(m) && (withOpen || !openMonths.has(m)))
    if (!ms.length) return null
    // 영업이익은 판관비가 있는 월의 매출이익만으로 계산 (판관비 미반영 월까지 넣으면 영업이익이 부풀려짐)
    const t = sum(data?.team.filter((r) => ms.includes(r.sales_month)) ?? [])
    return {
      amount: ms.reduce((s, m) => s + sgaOf.get(m)!, 0), open: ms.filter((m) => openMonths.has(m)),
      profit: t.profit, supply: t.supply, missing: months.filter((m) => inMonth({ sales_month: m }) && !sgaOf.has(m)),
    }
  }, [withSga, withOpen, team, months, inMonth, sgaOf, openMonths, data])
  const opProfit = sga ? sga.profit - sga.amount : null

  // 월별 추이도 상단 기간만 (기본 올해, [전체]면 전 기간)
  const trend = useMemo(() => {
    const byMonth = groupBy(data?.team.filter(inTeam) ?? [], (r) => r.sales_month)
    return months.filter((m) => inMonth({ sales_month: m })).map((m) => {
      const t = sum(byMonth.get(m) ?? [])
      const prov = provMonths.has(m)
      const s = withSga && team === ALL ? sgaOf.get(m) : undefined
      const op = s === undefined ? null : t.profit - s
      const open = openMonths.has(m) && !withOpen // 결산 전 + 제외 보기: 점선·빈 점으로만 표시
      return {
        month: m, label: `${m.slice(2, 4)}.${Number(m.slice(5, 7))}` + (prov ? '*' : ''), prov, supply: t.supply, profit: t.profit, rate: rate(t.profit, t.costedSupply),
        opProfit: op, opSolid: open ? null : op, open,
      }
    })
  }, [data, months, inMonth, inTeam, provMonths, withSga, withOpen, team, sgaOf, openMonths])

  const teamSummary = useMemo(() => summarizeTeams(data, months, inMonth), [data, inMonth, months])
  // 매출목표 칼럼: 고른 기간 중 목표가 있는 달 기준. 하나도 없으면 칼럼 숨김, 일부만 있으면 '(2026)' 표시 + 안내
  const targetCover = useMemo(() => {
    const has = new Set((data?.targets ?? []).map((t) => t.target_month))
    const inRange = months.filter((m) => inMonth({ sales_month: m }))
    const covered = inRange.filter((m) => has.has(m))
    return { none: covered.length === 0, partial: covered.length > 0 && covered.length < inRange.length, years: [...new Set(covered.map((m) => m.slice(0, 4)))].join('·') }
  }, [data, months, inMonth])
  // 목표 달성률 카드도 상단 기간 기준 (부서별 표와 같은 teamSummary)
  const yearSummary = teamSummary

  // 목표 달성률: 색은 예전 점유율 도넛과 같은 규칙 (매출 순위 1~7위 PALETTE, 그 아래 회색). 목표 없는 부서는 빠짐
  const teamAchieve = useMemo(
    () => [...yearSummary].sort((a, b) => b.supply - a.supply)
      .map((t, i) => ({ ...t, color: PALETTE[Math.min(i, PALETTE.length - 1)] })).filter((t) => t.target)
      .sort((a, b) => a.sales_team.localeCompare(b.sales_team, 'ko')), // 표시는 부서 이름순 (색은 매출 순위 그대로)
    [yearSummary],
  )
  const yearRange = from === ALL ? undefined : { from, to }
  const achMax = Math.min(200, Math.max(120, ...teamAchieve.map((t) => t.achieve ?? 0))) // 막대 눈금 끝 (%): 200% 넘으면 잘림

  const topItems = useMemo<ItemSummary[]>(() => {
    const rows = data?.item.filter(inMonth) ?? []
    return [...groupBy(rows, (r) => `${r.item_code}|${r.item_name}`)]
      .map(([, list]) => {
        const t = sum(list)
        const provCost = list.filter((r) => r.provisional_supply_amount !== 0).map((r) => r.cost_month ?? '').sort()
        return {
          item_name: list[0].item_name,
          item_code: list[0].item_code,
          item_type: list[0].item_type ?? '',
          ...t,
          rate: rate(t.profit, t.costedSupply),
          unit_price: t.qty ? t.supply / t.qty : 0,
          costMonth: provCost.at(-1) || null,
        }
      })
      .sort((a, b) => b.supply - a.supply)
      .slice(0, 50)
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

  const provShare = kpi.costedSupply ? (kpi.provSupply / kpi.costedSupply) * 100 : 0
  const provNote = kpi.provSupply ? ` · 가결산 ${provShare.toFixed(0)}%` : ''
  const kpiCards = [
    { label: '총 매출액', value: fmtWon(kpi.supply), sub: fmtCompact(kpi.supply) + '원', prov: false },
    { label: '총 원가', value: fmtWon(kpi.cost), sub: `원가 반영 매출 ${fmtCompact(kpi.costedSupply)}원${provNote}`, prov: true },
    {
      label: '총 매출이익', value: fmtWon(kpi.profit), prov: true,
      // 확정 = 전체 − 가결산 − 세트추정 (원가 0 비대상은 확정에 포함)
      sub: kpi.provSupply || kpi.setSupply || kpi.buySupply
        ? [`확정 ${fmtCompact(kpi.profit - kpi.provProfit - kpi.setProfit - kpi.buyProfit)}원`,
           kpi.provSupply && `가결산 ${fmtCompact(kpi.provProfit)}원`,
           (kpi.setSupply || kpi.buySupply) && `추정 ${fmtCompact(kpi.setProfit + kpi.buyProfit)}원`].filter(Boolean).join(' · ')
        : fmtCompact(kpi.profit) + '원',
    },
    { label: '전체 이익률', value: fmtPct(rate(kpi.profit, kpi.costedSupply)), sub: `매출이익 ÷ 원가 반영 매출${provNote}`, prov: true },
    ...(withSga
      ? [
          {
            label: '판관비', value: sga ? fmtWon(sga.amount) : '-', prov: false,
            sub: team !== ALL ? '부서별 배분 기준 미정 (전체 부서만 표시)'
              : sga ? '영림원 손익계산서 기준' + (openInView.length && !withOpen ? ` · 결산 전 ${openInView.map(monthLabel).join('·')} 제외` : '')
              : openInView.length ? `결산 전 월 · '결산 전 포함'을 누르면 표시` : '판관비 미적재',
          },
          {
            label: '영업이익', value: opProfit === null ? '-' : fmtWon(opProfit), prov: true,
            sub: !sga || opProfit === null
              ? (team === ALL && openInView.length ? `결산 전 월 · '결산 전 포함'을 누르면 표시` : '전체 부서에서만 표시')
              : [openInView.length && (withOpen ? `결산 전 ${openInView.map(monthLabel).join('·')} 포함 (판관비 진행 중)`
                                                 : `결산 전 ${openInView.map(monthLabel).join('·')} 제외`),
                 sga.missing.length && `판관비 없는 ${sga.missing.map(monthLabel).join('·')} 제외`,
                 `영업이익률 ${fmtPct(rate(opProfit, sga.supply))}`].filter(Boolean).join(' · '),
          },
        ]
      : [{ label: '총 수량', value: fmtNumber(kpi.qty), sub: '판매수량 합계', prov: false }]),
  ]

  const mergeNote = useMemo(() => {
    if (team === ALL) return null
    const byFrom = groupBy(data?.merged.filter((m) => m.to === team && inMonth({ sales_month: m.month })) ?? [], (m) => m.from)
    if (!byFrom.size) return null
    return [...byFrom].map(([from, list]) => `${list.map((m) => m.month).sort().map(monthLabel).join('·')} 매출은 당시 ${from} 매출`).join(', ')
  }, [data, team, inMonth])

  const periodLabel = from === ALL ? '전체 기간' : from === to ? ymLabel(from) : `${ymLabel(from)} ~ ${ymLabel(to)}`

  if (narrow && !pcView)
    return (
      <MobileView
        loading={loading} error={error} onReload={load}
        months={months} month={from === ALL ? ALL : from === to ? from : `${from}~${to}`}
        setMonth={(m) => !m.includes('~') && (setFrom(m), setTo(m))} teams={teams} team={team} setTeam={setTeam}
        kpi={kpi} teamSummary={teamSummary} topItems={topItems} topCustomers={topCustomers}
        onPcView={() => { setPcView(true); scrollTo(0, 0) }} onLogout={() => supabase.auth.signOut()}
        mergeNote={mergeNote && `${team} ${mergeNote}입니다`}
      />
    )

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
              {loadedAt &&
                `${loadedAt.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 업데이트`}
            </p>
          </div>
        </div>
        <div className="filters glass">
          {/* 기간: 처음부터 시작월~끝월 달력 칸 고정 (선택에 따라 줄이 늘거나 바뀌지 않게). 전체 = 모든 월 */}
          <div className="select period">
            <CalendarDays size={15} />
            <input type="month" value={from === ALL ? months[0] ?? '' : from} min={months[0]} max={months[months.length - 1]} aria-label="시작월"
              onChange={(e) => { const v = e.target.value; if (!v) return; setFrom(v); setTo((t) => (t === ALL ? months[months.length - 1] : t < v ? v : t)) }} />
            <span>~</span>
            <input type="month" value={to === ALL ? months[months.length - 1] ?? '' : to} min={months[0]} max={months[months.length - 1]} aria-label="끝월"
              onChange={(e) => { const v = e.target.value; if (!v) return; setTo(v); setFrom((f) => (f === ALL ? months[0] : f > v ? v : f)) }} />
            <button type="button" className={from === ALL ? 'period-all active' : 'period-all'} onClick={() => { setFrom(ALL); setTo(ALL) }}>전체</button>
          </div>
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
          <button
            className={withSga ? 'btn' : 'btn ghost'}
            onClick={() => setWithSga((v) => !v)}
            aria-pressed={withSga}
            title="판관비·영업이익 표시 전환 (영림원 손익계산서 기준, 전체 부서만)"
          >
            <Landmark size={15} />
            <span>{withSga ? '판관비 포함' : '판관비 미포함'}</span>
          </button>
          {withSga && team === ALL && openInView.length > 0 && (
            <button
              className={withOpen ? 'btn' : 'btn ghost'}
              onClick={() => setWithOpen((v) => !v)}
              aria-pressed={withOpen}
              title="결산 전 월(손익계산서 매출원가 0)의 판관비·영업이익을 합계에 넣을지 전환. 결산 전 판관비는 아직 쌓이는 중"
            >
              <CalendarDays size={15} />
              <span>{withOpen ? '결산 전 포함' : '결산 전 제외'}</span>
            </button>
          )}
          <RunButton onDone={load} />
          {narrow && (
            <button className="btn ghost" onClick={() => setPcView(false)} title="모바일 화면으로">
              <Smartphone size={15} />
            </button>
          )}
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

      {(provInView.length > 0 || kpi.setSupply !== 0 || kpi.buySupply !== 0) && (
        // 가결산·추정 안내: 평소 한 줄 요약, '자세히'로 전체 설명
        <details className="notes" role="note">
          <summary>
            {provInView.length > 0 && (
              <span className="note-item">
                <span className="badge-prov">가결산</span>
                <span><b>{provInView.map(monthLabel).join(', ')}</b> 원가 미확정 → 최근 확정 원가로 계산 (결산 후 바뀔 수 있음)</span>
              </span>
            )}
            {(kpi.setSupply !== 0 || kpi.buySupply !== 0) && (
              <span className="note-item">
                <span className="badge-prov badge-set">추정</span>
                <span>원가 이력 없는 매출 <b>{fmtCompact(kpi.setSupply + kpi.buySupply)}원</b> 원가 추정</span>
              </span>
            )}
            <span className="note-more" />
          </summary>
          <div className="notes-body">
            {provInView.length > 0 && (
              <p>
                <span className="badge-prov">가결산</span>
                <span>
                  원가가 확정되지 않아 품목별 가장 최근 확정 원가로 계산한 값입니다. 원가·이익·이익률이 결산 후 바뀔 수 있습니다.
                  차트의 <b>*</b> 표시·빗금 막대, 표의 <i>기울임 글씨</i>가 가결산·추정이 섞인 값입니다.
                </span>
              </p>
            )}
            {(kpi.setSupply !== 0 || kpi.buySupply !== 0) && (
              <p>
                <span className="badge-prov badge-set">추정</span>
                <span>
                  {kpi.setSupply !== 0 && <><b>세트추정 {fmtCompact(kpi.setSupply)}원</b>: 선물세트 구성품 원가 합(포장재 제외). </>}
                  {kpi.buySupply !== 0 && <><b>구매가추정 {fmtCompact(kpi.buySupply)}원</b>: 최근 구매단가(부대비용 제외). </>}
                  운송비·식음료 기타·a/s·적립금차감은 원가 0으로 매출·이익에 포함됩니다.
                </span>
              </p>
            )}
          </div>
        </details>
      )}

      {loading && !data ? (
        <div className="loading">
          <RefreshCw size={28} className="spin" />
          <p className="muted">데이터를 불러오는 중…</p>
        </div>
      ) : (
        <main className={loading ? 'refreshing' : ''}>
          <section className={withSga ? 'kpis with-sga' : 'kpis'}>
            {kpiCards.map(({ label, value, sub, prov }, i) => (
              <div key={label} className={`kpi glass ${prov && kpi.provSupply ? 'is-prov' : ''}`} style={{ animationDelay: `${i * 60}ms` }}>
                <div className="kpi-head">
                  <span className="muted">{label}</span>
                </div>
                <div className="kpi-value">{value}</div>
                <div className="muted small">{sub}</div>
              </div>
            ))}
          </section>

          <section className="charts">
            <div className="card glass">
              <div className="card-head">
                <h2>월별 매출 추이</h2>
                <span className="muted small">
                  막대: 매출액 · 선: 매출이익{withSga && team === ALL && ' · 주황 선: 영업이익(매출이익 − 판관비)'}
                  {withSga && team === ALL && !withOpen && openInView.length > 0 && ' · 주황 점선: 결산 전 (합계 제외)'}
                  {provMonths.size > 0 && ' · * 빗금: 이익 가결산'}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3182f6" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#3182f6" stopOpacity={0.45} />
                    </linearGradient>
                    <pattern id="barHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="6" height="6" fill="#3182f6" fillOpacity={0.35} />
                      <line x1="0" y1="0" x2="0" y2="6" stroke="#3182f6" strokeWidth={2.5} />
                    </pattern>
                  </defs>
                  <CartesianGrid stroke="#eef0f3" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748b" tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={56} />
                  <Tooltip
                    isAnimationActive={false} // 툴팁이 날아오지 않고 그 자리에 바로 나타나게
                    contentStyle={tooltipStyle}
                    cursor={{ fill: 'rgba(49,130,246,0.06)' }}
                    formatter={(v, name, item) => [
                      fmtWon(Number(v)),
                      name === 'supply' ? '매출액'
                        : name === 'opProfit' ? (item.payload.open ? '영업이익 (결산 전, 합계 제외)' : '영업이익')
                        : item.payload.prov ? '매출이익 (가결산)' : '매출이익',
                    ]}
                  />
                  <Bar dataKey="supply" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {trend.map((t) => (
                      <Cell
                        key={t.month}
                        fill={t.prov ? 'url(#barHatch)' : 'url(#barGrad)'}
                        fillOpacity={inMonth({ sales_month: t.month }) ? 1 : 0.3}
                      />
                    ))}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="profit"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={(p: { cx?: number; cy?: number; index?: number }) => (
                      <circle
                        key={p.index}
                        cx={p.cx}
                        cy={p.cy}
                        r={trend[p.index ?? 0]?.prov ? 4 : 3}
                        fill={trend[p.index ?? 0]?.prov ? '#fff' : '#10b981'}
                        stroke="#10b981"
                        strokeWidth={2}
                      />
                    )}
                  />
                  {withSga && team === ALL && (
                    <>
                      {/* 점선 = 전체 월(툴팁 담당), 실선 = 합계에 들어가는 월만 덮어 그림 -> 결산 전 구간만 점선으로 보임 */}
                      <Line
                        type="monotone" dataKey="opProfit" stroke="#f97316" strokeWidth={2.5} strokeDasharray="6 4" isAnimationActive={false}
                        dot={(p: { cx?: number; cy?: number; index?: number }) => trend[p.index ?? 0]?.open
                          ? <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill="#fff" stroke="#f97316" strokeWidth={2} />
                          : <g key={p.index} />}
                      />
                      <Line type="monotone" dataKey="opSolid" stroke="#f97316" strokeWidth={2.5} dot={{ r: 3 }} tooltipType="none" isAnimationActive={false} />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="card glass ach-card">
              <div className="card-head">
                <h2>부서별 목표 달성률</h2>
                <span className="muted small">{periodLabel} 목표 달성률</span>
              </div>
              {teamAchieve.length ? (
                <ul className="ach-list">
                  <li className="ach-row ach-scale" aria-hidden="true">
                    <span />
                    <span className="ach-track-label"><span style={{ left: `${(100 / achMax) * 100}%` }}>100%</span></span>
                  </li>
                  {teamAchieve.map((t) => (
                    <li key={t.sales_team}>
                      {/* 막대를 누르면 그 부서 거래처별 조회로 (예전 점유율 도넛과 같은 동작) */}
                      <button type="button" className={`ach-row${team !== ALL && team !== t.sales_team ? ' dim' : ''}`}
                        title={`${t.sales_team} 거래처별 매출·원가 보기`} onClick={() => openTeamPivot([t.sales_team], yearRange)}>
                        <span className="legend-name">{t.sales_team}</span>
                        <span className="ach-track">
                          <span className="ach-bar" style={{ width: `${(Math.min(t.achieve ?? 0, achMax) / achMax) * 100}%`, background: `linear-gradient(90deg, ${t.color}9e, ${t.color}f2)` }} />
                          <span className="ach-goal" style={{ left: `${(100 / achMax) * 100}%` }} />
                        </span>
                        <b>{fmtPct(t.achieve)}</b>
                        <span className="muted small">{fmtCompact(t.targetSupply)} / {fmtCompact(t.target ?? 0)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">{periodLabel} 매출목표가 없습니다</p>
              )}
              {teamAchieve.length > 0 && yearSummary.some((t) => !t.target && t.supply) && (
                <p className="muted small ach-note">목표가 없는 부서({yearSummary.filter((t) => !t.target && t.supply).map((t) => t.sales_team).join(', ')})는 빠집니다</p>
              )}
            </div>

          </section>

          <section className="card glass" id="detail-tabs">
            <nav className="tabs">
              <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>
                <Building2 size={15} /> 부서별 실적
              </button>
              <button className={tab === 'item' ? 'active' : ''} onClick={() => setTab('item')}>
                <Package size={15} /> 베스트 품목 TOP 50
              </button>
              <button className={tab === 'customer' ? 'active' : ''} onClick={() => setTab('customer')}>
                <Users size={15} /> 주요 거래처 TOP 30
              </button>
              <button className={tab === 'pivot' ? 'active' : ''} onClick={() => setTab('pivot')}>
                <TableIcon size={15} /> 조회
              </button>
            </nav>
            {mergeNote && (tab === 'team' || tab === 'customer') && <p className="merge-note">{team} {mergeNote}입니다 (현재 부서로 합쳐 표시)</p>}
            <div className="tab-body" key={tab}>
              {tab === 'team' && (
                // 기본: 본부순 → 매출목표 큰 순
                <DataTable rows={teamSummary} columns={teamColumns(team, targetCover)} searchKeys={['hq', 'sales_team']} defaultSort="hq" defaultAsc thenBy="target"
                  note={targetCover.partial ? `매출목표·달성률은 목표가 있는 ${targetCover.years}년 기간만 기준` : undefined} />
              )}
              {tab === 'item' && (
                <DataTable
                  rows={topItems}
                  columns={itemColumns}
                  searchKeys={['item_name', 'item_type']}
                  defaultSort="supply"
                  rank
                  note={team === ALL ? undefined : '품목 집계에는 부서 필터가 적용되지 않습니다'}
                />
              )}
              {tab === 'pivot' && <PivotView
                  key={pivotFocus?.key ?? 0}
                  focus={pivotFocus && { teams: pivotFocus.teams, from: pivotFocus.range?.from ?? (from === ALL ? null : from), to: pivotFocus.range?.to ?? (from === ALL ? null : to) }}
                  months={pivotMonths} teams={pivotTeams} provMonths={provMonths} itemNames={pivotItems} />}
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
      <ChatPanel />
    </div>
  )
}

const money = <T extends Totals>(key: keyof Totals) => (r: T) => fmtWon(r[key])
// 매출이익 칸: 가결산·추정이 섞인 행은 기울임 + 옅은 배경
const profitCell = <T extends Totals>(r: T) => (
  <span className={r.provSupply || r.setSupply || r.buySupply ? 'prov' : ''}>{fmtWon(r.profit)}</span>
)
const pct = <T extends { rate: number | null }>(r: T) => (
  <span className={r.rate !== null && r.rate < 0 ? 'neg' : ''}>{fmtPct(r.rate)}</span>
)

function teamColumns(selected: string, cover: { none: boolean; partial: boolean; years: string }): Column<TeamSummary>[] {
  const y = cover.partial ? `(${cover.years})` : ''
  const cols: Column<TeamSummary>[] = [
    { key: 'hq', label: '본부', sortBy: 'hq_rank', group: true, render: (r) => <b>{r.hq}</b> },
    {
      key: 'sales_team',
      label: '부서',
      render: (r) => <span className={r.sales_team === selected ? 'highlight' : ''}>{r.sales_team}</span>,
    },
    { key: 'supply', label: '매출액', align: 'right', render: money('supply') },
    { key: 'target', label: `매출목표${y}`, align: 'right', render: (r) => (r.target === null ? <span className="dim">-</span> : fmtWon(r.target)) },
    { key: 'achieve', label: `달성률${y}`, align: 'right', render: (r) => fmtPct(r.achieve) },
    { key: 'costedSupply', label: '원가 반영 매출', align: 'right', render: money('costedSupply') },
    { key: 'cost', label: '원가', align: 'right', render: money('cost') },
    { key: 'profit', label: '매출이익', align: 'right', render: profitCell },
    { key: 'rate', label: '이익률', align: 'right', render: pct },
  ]
  return cover.none ? cols.filter((c) => c.key !== 'target' && c.key !== 'achieve') : cols
}

const itemColumns: Column<ItemSummary>[] = [
  { key: 'item_name', label: '품목명' },
  { key: 'item_type', label: '분류' },
  { key: 'supply', label: '매출액', align: 'right', render: money('supply') },
  { key: 'profit', label: '매출이익', align: 'right', render: profitCell },
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
  { key: 'profit', label: '매출이익', align: 'right', render: profitCell },
  { key: 'rate', label: '이익률', align: 'right', render: pct },
  { key: 'qty', label: '수량', align: 'right', render: (r) => fmtNumber(r.qty) },
]
