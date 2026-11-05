import { useState } from 'react'
import { BarChart3, LogOut, Monitor, RefreshCw } from 'lucide-react'
import { fmtCompact, fmtNumber, fmtPct, monthLabel, rate } from '../lib/format'
import type { CustomerSummary, ItemSummary, TeamSummary } from '../App'
import { ChatPanel } from './ChatPanel'

const ALL = 'all'
const FOLD = 5 // 품목·거래처는 5위까지 먼저 보여주고 '더 보기'로 펼침

interface Props {
  loading: boolean
  error: string | null
  onReload: () => void
  months: string[]
  month: string
  setMonth: (m: string) => void
  teams: string[]
  team: string
  setTeam: (t: string) => void
  kpi: { supply: number; profit: number; costedSupply: number }
  teamSummary: TeamSummary[]
  topItems: ItemSummary[]
  topCustomers: CustomerSummary[]
  onPcView: () => void
  onLogout: () => void
  mergeNote: string | null // 고른 부서에 옛 부서 매출이 합쳐졌을 때 안내
}

type MTab = 'team' | 'item' | 'customer'

/** 휴대폰 화면(B안): 숫자 4칸 + 부서 카드 / 품목·거래처 순위. 표·차트·조회는 PC 화면에서 */
export function MobileView(p: Props) {
  const [tab, setTab] = useState<MTab>('team')
  const [open, setOpen] = useState(false)

  // 달성률: 목표가 있는 부서만 (부서를 고르면 그 부서만)
  const targeted = p.teamSummary.filter((t) => t.target !== null && (p.team === ALL || t.sales_team === p.team))
  const targetSum = targeted.reduce((s, t) => s + t.target!, 0)
  const achieve = targetSum ? (targeted.reduce((s, t) => s + t.supply, 0) / targetSum) * 100 : null

  const pick = (t: MTab) => {
    setTab(t)
    setOpen(false)
  }
  // 부서 카드 탭 → 그 부서로 거르고 거래처 순위(매출·이익·이익률)로 이동 (PC 점유율 클릭 → 조회와 같은 정보)
  const openTeam = (team: string) => {
    p.setTeam(team)
    pick('customer')
    document.querySelector('.m-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const ranked =
    tab === 'item'
      ? p.topItems.map((r) => ({
          name: r.item_name, sub: `${r.item_type || '분류 없음'} · ${fmtNumber(r.qty)}개`, supply: r.supply, profit: r.profit, rate: r.rate,
        }))
      : p.topCustomers.map((r) => {
          const ts = r.sales_team.split(', ')
          return { name: r.customer_name, sub: ts.length > 1 ? `${ts[0]} 외 ${ts.length - 1}곳` : ts[0], supply: r.supply, profit: r.profit, rate: r.rate }
        })

  return (
    <div className="m-app">
      <header className="m-top">
        <div className="brand">
          <div className="brand-mark m-mark"><BarChart3 size={16} /></div>
          <h1>매출 실적</h1>
        </div>
        <div className="m-actions">
          <button className="m-icon" onClick={p.onReload} disabled={p.loading} aria-label="새로고침">
            <RefreshCw size={18} className={p.loading ? 'spin' : ''} />
          </button>
          <button className="m-icon" onClick={p.onLogout} aria-label="로그아웃"><LogOut size={18} /></button>
        </div>
      </header>

      <div className="m-filters">
        <label>기간
          <select value={p.month} onChange={(e) => p.setMonth(e.target.value)}>
            <option value={ALL}>전체 기간</option>
            {p.months.map((m) => <option key={m} value={m}>{m.slice(0, 4)}년 {monthLabel(m)}</option>)}
          </select>
        </label>
        <label>부서
          <select value={p.team} onChange={(e) => p.setTeam(e.target.value)}>
            <option value={ALL}>전체 부서</option>
            {p.teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      {p.error && (
        <div className="alert glass">
          데이터를 불러오지 못했습니다: {p.error}
          <button className="btn" onClick={p.onReload}>다시 시도</button>
        </div>
      )}

      <section className="m-kpis">
        <div className="m-card"><span>매출액</span><b>{fmtCompact(p.kpi.supply)}</b></div>
        <div className="m-card">
          <span>목표 달성률</span><b>{fmtPct(achieve)}</b>
          <div className="m-bar soft"><i style={{ width: `${Math.min(100, achieve ?? 0)}%` }} /></div>
        </div>
        <div className="m-card"><span>매출이익</span><b>{fmtCompact(p.kpi.profit)}</b></div>
        <div className="m-card"><span>이익률</span><b>{fmtPct(rate(p.kpi.profit, p.kpi.costedSupply))}</b></div>
      </section>

      <nav className="m-tabs">
        <button className={tab === 'team' ? 'active' : ''} onClick={() => pick('team')}>부서별</button>
        <button className={tab === 'item' ? 'active' : ''} onClick={() => pick('item')}>품목 TOP</button>
        <button className={tab === 'customer' ? 'active' : ''} onClick={() => pick('customer')}>거래처 TOP</button>
      </nav>

      <p className="m-count">
        {tab === 'team' ? `${p.teamSummary.length}개 부서 · 매출액순`
          : tab === 'item' ? `매출액 상위 ${p.topItems.length}개 품목${p.team === ALL ? '' : ' · 부서 필터 미적용'}`
          : `${p.team === ALL ? '' : p.team + ' · '}매출액 상위 ${p.topCustomers.length}개 거래처`}
      </p>

      {p.mergeNote && tab !== 'item' && <p className="merge-note">{p.mergeNote} (현재 부서로 합쳐 표시)</p>}

      {tab === 'team' ? (
        <div className="m-list">
          {[...p.teamSummary].sort((a, b) => b.supply - a.supply).map((t) => (
            <button type="button" key={t.sales_team} className={`m-card m-team ${t.sales_team === p.team ? 'selected' : ''}`} onClick={() => openTeam(t.sales_team)}>
              <div className="m-row"><b className="m-name">{t.sales_team}</b><b>{fmtCompact(t.supply)}</b></div>
              <div className="m-bar"><i className={t.achieve !== null && t.achieve >= 100 ? 'over' : ''} style={{ width: `${Math.min(100, t.achieve ?? 0)}%` }} /></div>
              <div className="m-row muted small">
                {t.target === null || t.achieve === null ? <span>목표 없음</span> : (
                  <span>목표 {fmtCompact(t.target)} · <b className={t.achieve >= 100 ? 'm-over' : t.achieve < 50 ? 'm-low' : ''}>{fmtPct(t.achieve)}</b></span>
                )}
                <span>이익률 {fmtPct(t.rate)}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <>
          <ol className="m-card m-rank">
            {(open ? ranked : ranked.slice(0, FOLD)).map((r, i) => (
              <li key={r.name + i}>
                <span className="m-no">{i + 1}</span>
                <div className="m-grow"><b className="m-name">{r.name}</b><span className="muted small">{r.sub}</span></div>
                <div className="m-right"><b>{fmtCompact(r.supply)}</b><span className="muted small">이익 {fmtCompact(r.profit)} · {fmtPct(r.rate)}</span></div>
              </li>
            ))}
            {ranked.length === 0 && <li className="muted">데이터가 없습니다.</li>}
          </ol>
          {!open && ranked.length > FOLD && (
            <button className="m-more" onClick={() => setOpen(true)}>{FOLD + 1}~{ranked.length}위 더 보기</button>
          )}
        </>
      )}

      <button className="m-pc" onClick={p.onPcView}><Monitor size={17} /> PC 대시보드 열기</button>
      <ChatPanel />
    </div>
  )
}
