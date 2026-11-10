import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Search, X } from 'lucide-react'
import { getPivot, type PivotRow } from '../lib/supabase'
import { fmtNumber, monthLabel } from '../lib/format'
import {
  COST_MEASURES, EX_CATEGORIES, FIELD_LABEL, MEASURE_LABEL, PRESETS, RETAIL,
  allParents, buildTree, toCurrentTeams, flatten, lastDay, presetCfg, sumCells, toParams, value,
  type Cfg, type Field, type Measure, type Node,
} from '../lib/pivot'

const CUSTOM = 'custom'
const yearStart = `${new Date().getFullYear()}-01-01` // 조회 기본 시작일 (올해 1월 1일)
const TEAM_CUSTOMER = 'team-customer'
const GROUPS = [...new Set(PRESETS.map((p) => p.group))]
const pathLabel = (rows: Field[]) => rows.map((f) => FIELD_LABEL[f]).join(' > ')
const fmt = (v: number | null, m: Measure) => (v == null ? '' : m === 'rate' ? `${(v * 100).toFixed(1)}%` : fmtNumber(v))
const sameSet = (a: string[], b: string[]) => a.length === b.length && b.every((x) => a.includes(x))

function Seg<T extends string>({ value: v, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([k, label]) => (
        <button key={k} type="button" className={k === v ? 'active' : ''} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function PivotView({ months, teams, provMonths, itemNames, focus }: {
  months: string[]; teams: string[]; provMonths: Set<string>; itemNames: string[]
  focus?: { teams: string[]; from: string | null; to: string | null } | null // 점유율 차트에서 부서 클릭으로 열 때 (상단 기간)
}) {
  const [presetId, setPresetId] = useState(focus ? TEAM_CUSTOMER : CUSTOM)
  const [cfg, setCfgState] = useState<Cfg>(() =>
    focus ? { ...presetCfg(PRESETS.find((p) => p.id === TEAM_CUSTOMER)), teams: focus.teams } : presetCfg(undefined))
  const [modified, setModified] = useState(false)
  // 기간은 일 단위 (YYYY-MM-DD). 열은 월별이라 걸친 월이 열로 나옴
  const first = months[0] ? `${months[0]}-01` : ''
  const last = months.length ? lastDay(months[months.length - 1]) : ''
  // 기본 기간은 올해(3년 전체는 무거워 DB 시간 제한에 걸림). 데이터가 올해 이전에 끝나면 처음부터
  const [from, setFrom] = useState(focus?.from ? `${focus.from}-01` : last >= yearStart && first < yearStart ? yearStart : first)
  const [to, setTo] = useState(focus?.to ? lastDay(focus.to) : last)
  const today = new Date().toLocaleDateString('sv-SE') // 로컬 YYYY-MM-DD
  const [openYears, setOpenYears] = useState(() => new Set([to.slice(0, 4)])) // 연도 접기: 펼친 연도 (기본 마지막 해)
  const [showAll, setShowAll] = useState(false) // 상위 N개 프리셋에서 전체 하위 행 보기
  const [query, setQuery] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<PivotRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preset = PRESETS.find((p) => p.id === presetId)

  const choose = (id: string) => {
    setPresetId(id)
    setCfgState(presetCfg(PRESETS.find((p) => p.id === id)))
    setModified(false)
    setExpanded(new Set())
    setQuery('')
    setShowAll(false)
  }
  // 프리셋은 초기값만 채움: 이후 조건을 바꾸면 '바꿨음' 표시
  const update = (patch: Partial<Cfg>) => {
    setCfgState((c) => ({ ...c, ...patch }))
    if (presetId !== CUSTOM) setModified(true)
    setExpanded(new Set())
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    getPivot(toParams(cfg, from, to))
      .then((r) => alive && setRows(toCurrentTeams(r, cfg.rows)))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [cfg, from, to])

  const tree = useMemo(() => buildTree(rows, query), [rows, query])
  const top = showAll ? 0 : cfg.top
  // 상위 N개 보기: 처음부터 최상위 행(팀)을 펼쳐서 바로 상위 품목이 보이게
  useEffect(() => {
    if (cfg.top) setExpanded(new Set(tree.children.map((c) => c.key)))
  }, [tree, cfg.top])
  const visible = useMemo(() => flatten(tree, expanded, top), [tree, expanded, top])
  const fromM = from.slice(0, 7)
  const toM = to.slice(0, 7)
  const monthCols = months.filter((m) => (!fromM || m >= fromM) && (!toM || m <= toM))
  const byMeasure = cfg.col === 'measure'
  // 2개 연도 이상이면 연도별로 접기(+/−). 접힌 연도는 'YYYY' 칸 하나(연 합계)
  const years = [...new Set(monthCols.map((m) => m.slice(0, 4)))]
  const grouped = !byMeasure && years.length >= 2
  const monthsOf = (c: string) => (c.length === 4 ? monthCols.filter((m) => m.startsWith(c)) : [c])
  const cols: string[] = byMeasure ? (Object.keys(MEASURE_LABEL) as Measure[])
    : grouped ? years.flatMap((y) => (openYears.has(y) ? monthsOf(y) : [y])) : monthCols
  const toggleYear = (y: string) => setOpenYears((s) => { const n = new Set(s); if (n.has(y)) n.delete(y); else n.add(y); return n })
  const provInRange = monthCols.some((m) => provMonths.has(m))
  const retail = sameSet(cfg.teams, RETAIL)
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? itemNames.filter((n) => n.toLowerCase().includes(q) && !cfg.items.includes(n)).slice(0, 8) : []
  }, [query, itemNames, cfg.items])

  const cell = (n: Node, c: string) => {
    const m = byMeasure ? (c as Measure) : cfg.measure
    const v = value(byMeasure ? n.total : c.length === 4 ? sumCells(n, monthsOf(c)) : n.cells.get(c), m)
    // 원가·이익·이익률만 가결산 영향을 받음 (판매금액·수량은 확정 값)
    const prov = COST_MEASURES.has(m) && (byMeasure ? provInRange : monthsOf(c).some((x) => provMonths.has(x)))
    return (
      <td key={c} className={`num${prov ? ' prov' : ''}${v != null && v < 0 ? ' neg' : ''}`}>
        {fmt(v, m)}
      </td>
    )
  }
  const totalCell = (n: Node, cls: string) =>
    byMeasure ? null : (
      <td className={`num ${cls}${COST_MEASURES.has(cfg.measure) && provInRange ? ' prov' : ''}`}>{fmt(value(n.total, cfg.measure), cfg.measure)}</td>
    )
  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleTeam = (t: string) =>
    update({ teams: retail ? [t] : cfg.teams.includes(t) ? cfg.teams.filter((x) => x !== t) : [...cfg.teams, t] })
  const pin = (name: string) => {
    update({ items: [...cfg.items, name] })
    setQuery('')
    setSuggestOpen(false)
  }
  const setRowAt = (i: number, f: string) =>
    update({ rows: f ? [...new Set([...cfg.rows.slice(0, i), f as Field, ...cfg.rows.slice(i + 1)])] : cfg.rows.slice(0, i) })
  const levels = Math.min(cfg.rows.length + 1, 4)

  return (
    <div className="pivot">
      <div className="presets">
        <div className="pgroup">
          <span className="pgroup-label">기본</span>
          <div className="chips">
            <button type="button" className={`chip preset ${presetId === CUSTOM ? 'active' : ''}`} onClick={() => choose(CUSTOM)}>
              <span className="ct">직접 구성</span>
              <span className="cs">행·열을 직접 고름</span>
            </button>
          </div>
        </div>
        {GROUPS.map((g) => (
          <div key={g} className="pgroup">
            <span className="pgroup-label">{g}</span>
            <div className="chips">
              {PRESETS.filter((p) => p.group === g).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`chip preset ${p.id === presetId ? 'active' : ''}`}
                  title={p.old ? `구 시트 ${p.old}` : '시트에 없던 조합'}
                  onClick={() => choose(p.id)}
                >
                  <span className="ct">{p.name}</span>
                  <span className="cs">{pathLabel(p.rows)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="preset-note">
        {preset ? (
          <>
            <b>{preset.name}</b>
            <span className="muted">
              {preset.old ? `구 시트 ${preset.old}와 같은 조건으로 채웠습니다.` : '시트에는 없던 조합입니다.'}
            </span>
            {modified && (
              <>
                <span className="modified">· 조건을 바꿨습니다</span>
                <button type="button" className="linkbtn" onClick={() => choose(preset.id)}>프리셋 값으로 되돌리기</button>
              </>
            )}
          </>
        ) : (
          <>
            <b>직접 구성</b>
            <span className="muted">기본값은 KPI와 같은 기준(전체 포함)입니다. 프리셋을 누르면 아래 조건이 그 값으로 채워지고, 이후엔 자유롭게 바꿀 수 있습니다.</span>
          </>
        )}
      </div>

      <div className="pivot-panel">
        <div className="panel-title">조건</div>
        <div className="frow">
          <span className="lbl">기간</span>
          <div className="ctl">
            {/* 날짜 칸을 누르면 브라우저 달력이 열림. 지운 값('')은 무시 */}
            <input type="date" value={from} min={first} max={last} aria-label="시작일"
              onChange={(e) => { const v = e.target.value; if (!v) return; setFrom(v); if (to < v) setTo(v) }} />
            <span className="muted">~</span>
            <input type="date" value={to} min={first} max={last} aria-label="종료일"
              onChange={(e) => { const v = e.target.value; if (!v) return; setTo(v); if (from > v) setFrom(v) }} />
            <button type="button" className={from === first && to === today ? 'period-all active' : 'period-all'}
              onClick={() => { setFrom(first); setTo(today) }} title="첫 데이터 월 1일 ~ 오늘">전체</button>
          </div>
        </div>
        <div className="frow">
          <span className="lbl">출처</span>
          <div className="ctl">
            <Seg value={cfg.src} options={[['all', '전체'], ['국내', '국내'], ['수출', '수출']]} onChange={(src) => update({ src })} />
          </div>
        </div>
        <div className="frow">
          <span className="lbl">영업점구분</span>
          <div className="ctl">
            <Seg value={cfg.ch} options={[['all', '전체'], ['영업점', '영업점']]} onChange={(ch) => update({ ch })} />
          </div>
        </div>
        <div className="frow">
          <span className="lbl">부서</span>
          <div className="ctl chips">
            <button type="button" className={`chip small ${cfg.teams.length ? '' : 'active'}`} onClick={() => update({ teams: [] })}>전체</button>
            <button type="button" className={`chip small group ${retail ? 'active' : ''}`} title={RETAIL.join(', ')} onClick={() => update({ teams: [...RETAIL] })}>
              유통사업본부 ({RETAIL.length}개 팀)
            </button>
            {teams.map((t) => (
              <button key={t} type="button" className={`chip small ${!retail && cfg.teams.includes(t) ? 'active' : ''}`} onClick={() => toggleTeam(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="frow">
          <span className="lbl">비상품 제외</span>
          <div className="ctl">
            <Seg value={cfg.ex} options={[['none', '전체 포함'], ['base', '비상품 제외'], ['ext', '+ 원자재·a/s 제외']]} onChange={(ex) => update({ ex })} />
            <span className="muted small">{cfg.ex === 'none' ? '모든 자산분류 포함' : `제외: ${EX_CATEGORIES[cfg.ex].join(' · ')}`}</span>
          </div>
        </div>
        <div className="frow">
          <span className="lbl">품목</span>
          <div className="ctl chips">
            {cfg.items.length ? (
              cfg.items.map((n) => (
                <button key={n} type="button" className="chip small active" onClick={() => update({ items: cfg.items.filter((x) => x !== n) })} title="고정 해제">
                  {n} <X size={12} />
                </button>
              ))
            ) : (
              <span className="muted small">고정 없음 (전체 품목) · 표 위 검색창에서 품명 후보를 고르면 여기에 고정됩니다</span>
            )}
          </div>
        </div>
      </div>

      <div className="pivot-panel">
        <div className="panel-title">구성</div>
        <div className="frow">
          <span className="lbl">행 기준</span>
          <div className="ctl">
            {Array.from({ length: levels }, (_, i) => {
              const used = cfg.rows.slice(0, i)
              const opts = (Object.keys(FIELD_LABEL) as Field[]).filter((f) => !used.includes(f))
              return (
                <span key={i} className="row-level">
                  {i > 0 && <span className="muted">›</span>}
                  <select value={cfg.rows[i] ?? ''} onChange={(e) => setRowAt(i, e.target.value)} aria-label={`${i + 1}단계 행`}>
                    {i > 0 && <option value="">{i === cfg.rows.length ? '+ 단계 추가' : '없음'}</option>}
                    {opts.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                  </select>
                </span>
              )
            })}
          </div>
        </div>
        <div className="frow">
          <span className="lbl">열</span>
          <div className="ctl">
            <Seg value={cfg.col} options={[['month', '월별'], ['measure', '지표별 (기간 합계)']]} onChange={(col) => update({ col })} />
          </div>
        </div>
        <div className="frow">
          <span className="lbl">지표</span>
          <div className="ctl">
            {byMeasure ? (
              <span className="muted small">지표별 모드에서는 모든 지표가 열로 나옵니다</span>
            ) : (
              <Seg value={cfg.measure} options={Object.entries(MEASURE_LABEL) as [Measure, string][]} onChange={(measure) => update({ measure })} />
            )}
          </div>
        </div>
      </div>

      <div className="pivot-meta">
        <span className="muted small">
          행: {pathLabel(cfg.rows)} · 열: {byMeasure ? '지표별' : `월별 · ${MEASURE_LABEL[cfg.measure]}`}
        </span>
        <span className="pivot-actions">
          <span className="searchwrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setSuggestOpen(false)}>
            <label className="search">
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSuggestOpen(true) }}
                onFocus={() => setSuggestOpen(true)}
                onKeyDown={(e) => (e.key === 'Escape' || e.key === 'Enter') && setSuggestOpen(false)}
                placeholder="거래처·품명 검색"
                autoComplete="off"
              />
            </label>
            {suggestOpen && suggestions.length > 0 && (
              <div className="suggest">
                <div className="sug-head">품명 후보 · 고르면 품목 고정 (합계가 이 품목만으로 바뀜)</div>
                {suggestions.map((n) => (
                  <button key={n} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pin(n)}>
                    <span className="pin">고정</span>{n}
                  </button>
                ))}
                <div className="sug-foot">고르지 않으면 표 안에서 “{query.trim()}” 글자를 찾기만 합니다</div>
              </div>
            )}
          </span>
          {cfg.rows.length > 1 && (
            <>
              {/* 상위 N개 프리셋: 모두 펼치기 = 하위 행 전체 + 전부 펼침, 다시 누르면 상위 N개로 */}
              <button className="btn ghost small" onClick={() => {
                if (cfg.top && showAll) {
                  setShowAll(false)
                  setExpanded(new Set(tree.children.map((c) => c.key)))
                } else {
                  setShowAll(true)
                  setExpanded(new Set(allParents(tree)))
                }
              }}>{cfg.top && showAll ? `상위 ${cfg.top}개만` : '모두 펼치기'}</button>
              <button className="btn ghost small" onClick={() => { setShowAll(false); setExpanded(new Set()) }}>모두 접기</button>
            </>
          )}
        </span>
      </div>

      {error && <div className="alert glass">조회 실패: {error}</div>}

      <div className={`table-scroll pivot-scroll ${loading ? 'refreshing' : ''}`}>
        <table className="pivot-table">
          <thead>
            {grouped && (
              <tr className="year-row">
                <th rowSpan={2}>{cfg.rows.map((f) => FIELD_LABEL[f]).join(' / ')}</th>
                <th rowSpan={2} className="num">합계</th>
                {years.map((y) => (
                  <th key={y} colSpan={openYears.has(y) ? monthsOf(y).length : 1} className="year-th">
                    <button type="button" className="year-toggle" onClick={() => toggleYear(y)} title={openYears.has(y) ? '월 접기' : '월 펼치기'}>
                      {openYears.has(y) ? '−' : '+'}
                    </button>
                    {y}년
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {!grouped && <th>{cfg.rows.map((f) => FIELD_LABEL[f]).join(' / ')}</th>}
              {!byMeasure && !grouped && <th className="num">합계</th>}
              {cols.map((c) => (
                <th key={c} className="num">
                  {byMeasure ? MEASURE_LABEL[c as Measure] : c.length === 4 ? '연 합계' : grouped ? `${Number(c.slice(5, 7))}월` : monthLabel(c)}
                  {!byMeasure && provMonths.has(c) && <span className="badge-prov" title="원가 미확정: 품목별 최근 확정 원가로 계산">가결산</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td className="empty" colSpan={cols.length + 2}>
                  {loading ? <RefreshCw size={18} className="spin" /> : '조건에 맞는 데이터가 없습니다'}
                </td>
              </tr>
            )}
            {visible.map((n) => (
              <tr key={n.key} className={n.children.length ? 'group' : ''}>
                <td className="pivot-label" style={{ paddingLeft: 14 + n.depth * 20 }}>
                  {n.children.length > 0 ? (
                    <button className="tree-toggle" onClick={() => toggle(n.key)}>
                      {expanded.has(n.key) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {n.label}
                    </button>
                  ) : (
                    n.label
                  )}
                </td>
                {totalCell(n, 'strong')}
                {cols.map((c) => cell(n, c))}
              </tr>
            ))}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr>
                <td className="pivot-label">총계</td>
                {totalCell(tree, '')}
                {cols.map((c) => cell(tree, c))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="muted small">
        이익률 = 매출이익 ÷ 원가 반영 매출. 원가가 확정되지 않은 달(가결산)의 매출원가·매출이익은 품목별 가장 최근 확정 원가로 계산한 값입니다.
        원가 이력이 없는 선물세트는 구성품 원가 합, 그 밖의 품목은 최근 구매단가로 추정하고, 운송비·식음료 기타·a/s·적립금차감은 원가 0으로
        포함합니다. 구매 기록도 없는 품목만 원가·이익에서 빠집니다.
      </p>
    </div>
  )
}
