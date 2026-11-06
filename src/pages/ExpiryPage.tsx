import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { getExpiryLots, type ExpiryLotRow } from '../lib/supabase'
import { fmtNumber } from '../lib/format'
import { expiryStatus } from '../lib/stock'
import { DataTable, type Column } from '../components/DataTable'

const DAYS = [
  { label: '30일 이내', d: 30 },
  { label: '90일 이내', d: 90 },
  { label: '180일 이내', d: 180 },
  { label: '전체 기간', d: Infinity },
]

export function ExpiryPage() {
  const [rows, setRows] = useState<ExpiryLotRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(90)

  const load = () => {
    setError(null)
    getExpiryLots().then(setRows, (e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(load, [])

  const all = useMemo(() => rows ?? [], [rows])
  const view = useMemo(() => all.filter((r) => r.days_left <= days), [all, days])
  const within = (d: number) => all.filter((r) => r.days_left <= d).length
  const kpis = [
    { label: '지난 lot', value: all.filter((r) => r.days_left < 0).length },
    { label: '30일 이내', value: within(30) },
    { label: '90일 이내', value: within(90) },
    { label: '180일 이내', value: within(180) },
  ]

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div>
            <h1>유통기한</h1>
            <p className="muted small">
              유통기한 시트(lot = 시리얼/로트) · 남은 일수는 오늘 기준
              {all[0] && ` · ${all[0].snapshot_date} 적재`}
            </p>
          </div>
        </div>
        <button className="btn" onClick={load}><RefreshCw size={15} /><span>새로고침</span></button>
      </header>
      {error && <div className="alert glass">데이터를 불러오지 못했습니다: {error}</div>}
      {!rows && !error ? (
        <div className="loading"><RefreshCw size={28} className="spin" /><p className="muted">데이터를 불러오는 중…</p></div>
      ) : (
        <main>
          <section className="kpis">
            {kpis.map((k) => (
              <div key={k.label} className="kpi glass">
                <div className="kpi-head"><span className="muted">{k.label}</span></div>
                <div className="kpi-value">{k.value.toLocaleString()}</div>
              </div>
            ))}
          </section>
          <section className="card glass">
            <div className="chips stock-filters">
              <span className="muted small">유통기한 ~</span>
              {DAYS.map(({ label, d }) => (
                <button key={label} className={days === d ? 'chip active' : 'chip'} onClick={() => setDays(d)}>{label}</button>
              ))}
            </div>
            <DataTable rows={view} columns={columns} searchKeys={['item_name', 'item_code']} defaultSort="days_left" defaultAsc />
            <p className="muted small table-note">
              상태: 지남 · 30일 이내 임박 · 90일 이내 주의 · 180일 이내 관찰. 장기재고 미출고일수는 장기재고 목록에 있는 품목만 표시. 잔여율 = 남은 일수 ÷ 유통기간(개월 × 30.4일).
            </p>
          </section>
        </main>
      )}
    </>
  )
}

const columns: Column<ExpiryLotRow>[] = [
  { key: 'item_code', label: '품목코드' },
  { key: 'item_name', label: '품목명' },
  { key: 'expiry_date', label: 'lot(유통기한)' },
  { key: 'qty', label: '수량', align: 'right', render: (r) => fmtNumber(r.qty) },
  { key: 'days_left', label: '남은 일수', align: 'right', render: (r) => fmtNumber(r.days_left) },
  { key: 'shelf_months', label: '유통기간(개월)', align: 'right', render: (r) => (r.shelf_months === null ? '-' : fmtNumber(r.shelf_months)) },
  { key: 'remain_rate', label: '잔여율', align: 'right', render: (r) => (r.remain_rate === null ? '-' : `${(r.remain_rate * 100).toFixed(1)}%`) },
  {
    key: 'snapshot_date', label: '상태', sortBy: 'days_left',
    render: (r) => { const s = expiryStatus(r.days_left); return <span className={`tag ${s.tag}`}>{s.label}</span> },
  },
  { key: 'long_idle_days', label: '장기재고 미출고일수', align: 'right', render: (r) => (r.long_idle_days === null ? '-' : fmtNumber(r.long_idle_days)) },
  { key: 'amount', label: '재고금액', align: 'right', render: (r) => (r.amount === null ? '-' : fmtNumber(r.amount)) },
]
