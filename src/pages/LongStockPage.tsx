import { useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { getLongStock, type LongStockRow } from '../lib/supabase'
import { fmtCompact, fmtNumber } from '../lib/format'
import { BUCKETS, bucketOf, downloadCsv } from '../lib/stock'
import { DataTable, type Column } from '../components/DataTable'
import { BarList } from '../components/BarList'

const ALL = -1

export function LongStockPage() {
  const [rows, setRows] = useState<LongStockRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [goodsOnly, setGoodsOnly] = useState(true) // 기본 상품만. 카드·그래프·표 모두 이 기준
  const [bucket, setBucket] = useState(ALL)
  const [noOut, setNoOut] = useState(false)

  const load = () => {
    setError(null)
    getLongStock().then(setRows, (e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(load, [])

  const all = useMemo(() => (rows ?? []).filter((r) => !goodsOnly || r.item_category === '상품'), [rows, goodsOnly])
  const amt = (rs: LongStockRow[]) => rs.reduce((s, r) => s + (r.stock_amount ?? 0), 0)
  const byBucket = useMemo(
    () => BUCKETS.map((b, i) => { const rs = all.filter((r) => bucketOf(r.idle_days) === i); return { label: b.label, color: b.color, value: amt(rs), count: rs.length } }),
    [all],
  )
  const byCat = useMemo(() => {
    const m = new Map<string, LongStockRow[]>()
    for (const r of rows ?? []) m.set(r.item_category ?? '(없음)', [...(m.get(r.item_category ?? '(없음)') ?? []), r])
    return [...m].map(([label, rs]) => ({ label, color: '#3182f6', value: amt(rs), count: rs.length })).sort((a, b) => b.value - a.value)
  }, [rows])
  const view = useMemo(
    () => all.filter((r) => (bucket === ALL || bucketOf(r.idle_days) === bucket) && (!noOut || r.no_out)),
    [all, bucket, noOut],
  )

  const total = amt(all)
  const top10 = all.map((r) => r.stock_amount ?? 0).sort((a, b) => b - a).slice(0, 10).reduce((s, v) => s + v, 0)
  const old = byBucket[2].count + byBucket[3].count
  const noOutRows = all.filter((r) => r.no_out)
  const kpis = [
    { label: '장기재고 금액', value: `${fmtCompact(amt(all))}원`, sub: `${all.length.toLocaleString()} 품목` },
    { label: '1년 이상 미출고', value: `${fmtCompact(byBucket[2].value + byBucket[3].value)}원`, sub: `${old.toLocaleString()} 품목` },
    { label: '출고 이력 없음', value: `${noOutRows.length.toLocaleString()} 품목`, sub: `${fmtCompact(amt(noOutRows))}원` },
    { label: '상위 10품목 금액 비중', value: total ? `${Math.round((top10 / total) * 100)}%` : '-', sub: `${fmtCompact(top10)}원 / ${fmtCompact(total)}원` },
  ]

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div>
            <h1>장기재고</h1>
            <p className="muted small">
              영림원 장기재고조회 · 금액 = 최근 재고단가(재고금액상세조회) × 수량
              {all[0] && ` · 기준일 ${all[0].snapshot_date}`}
            </p>
          </div>
        </div>
        <div className="chips stock-filters">
          <select className="field" value={goodsOnly ? 'goods' : 'all'} onChange={(e) => setGoodsOnly(e.target.value === 'goods')} aria-label="품목자산분류">
            <option value="goods">상품</option>
            <option value="all">분류 전체</option>
          </select>
          <button className="btn" onClick={load}><RefreshCw size={15} /><span>새로고침</span></button>
        </div>
      </header>
      {error && <div className="alert glass">데이터를 불러오지 못했습니다: {error}</div>}
      {!rows && !error ? (
        <div className="loading"><RefreshCw size={28} className="spin" /><p className="muted">데이터를 불러오는 중…</p></div>
      ) : (
        <main>
          <section className="kpis kpis-4">
            {kpis.map((k) => (
              <div key={k.label} className="kpi glass">
                <div className="kpi-head"><span className="muted">{k.label}</span></div>
                <div className="kpi-value">{k.value}</div>
                <div className="muted small">{k.sub}</div>
              </div>
            ))}
          </section>
          <section className="charts">
            <div className="card glass">
              <div className="card-head"><h2>미출고 경과 구간별 금액</h2></div>
              <BarList items={byBucket} />
            </div>
            <div className="card glass">
              <div className="card-head"><h2>품목자산분류별 금액 <span className="muted small">(항상 전체 분류)</span></h2></div>
              <BarList items={byCat} />
            </div>
          </section>
          <section className="card glass">
            <div className="chips stock-filters">
              {[{ label: '전체', i: ALL }, ...BUCKETS.map((b, i) => ({ label: b.label, i }))].map(({ label, i }) => (
                <button key={label} className={bucket === i ? 'chip active' : 'chip'} onClick={() => setBucket(i)}>{label}</button>
              ))}
              <label className="check"><input type="checkbox" checked={noOut} onChange={(e) => setNoOut(e.target.checked)} /> 출고 이력 없음만</label>
              <button
                className="btn ghost push-right"
                onClick={() => downloadCsv('장기재고.csv', ['분류', '품명', '품번', '재고수량', '재고금액', '최종입고일', '최종출고일', '미출고일수'],
                  view.map((r) => [r.item_category, r.item_name, r.item_code, r.stock_qty, r.stock_amount === null ? null : Math.round(r.stock_amount), r.last_in_date, r.last_out_date, r.idle_days]))}
              >
                <Download size={15} /><span>엑셀(CSV)</span>
              </button>
            </div>
            <DataTable rows={view} columns={columns} searchKeys={['item_name', 'item_code']} defaultSort="stock_amount"
              note={`${fmtCompact(amt(view))}원`} />
            <p className="muted small table-note">
              미출고일수: 출고 이력이 없는 품목은 최종입고일 이후 경과일 (영림원 원본은 이 경우 2018-01-01 기준 일수를 냄).
              재고단가가 없는 품목은 금액 '-'.
            </p>
          </section>
        </main>
      )}
    </>
  )
}

const columns: Column<LongStockRow>[] = [
  { key: 'item_category', label: '분류' },
  { key: 'item_name', label: '품명' },
  { key: 'item_code', label: '품번' },
  { key: 'stock_qty', label: '재고수량', align: 'right', render: (r) => fmtNumber(r.stock_qty) },
  { key: 'stock_amount', label: '재고금액', align: 'right', render: (r) => (r.stock_amount === null ? '-' : fmtNumber(r.stock_amount)) },
  { key: 'last_in_date', label: '최종입고일' },
  { key: 'last_out_date', label: '최종출고일', render: (r) => r.last_out_date ?? <span className="tag tag-gray">출고없음</span> },
  { key: 'idle_days', label: '미출고일수', align: 'right', render: (r) => (r.idle_days === null ? '-' : fmtNumber(r.idle_days)) },
  {
    key: 'snapshot_date', label: '구간', sortBy: 'idle_days',
    render: (r) => { const b = BUCKETS[bucketOf(r.idle_days)]; return <span className={`tag ${b.tag}`}>{b.label}</span> },
  },
]
