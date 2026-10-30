import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { getPivot, type PivotRow } from '../lib/supabase'
import { fmtNumber, monthLabel } from '../lib/format'

type Field = 'sales_team' | 'channel_type' | 'customer_name' | 'item_category' | 'item_type' | 'item_name' | 'region'
type Measure = 'supply' | 'qty' | 'cost' | 'profit' | 'costed'

const FIELD_LABEL: Record<Field, string> = {
  sales_team: '부서',
  channel_type: '영업점구분',
  customer_name: '거래처',
  item_category: '품목자산분류',
  item_type: '품목소분류',
  item_name: '품명',
  region: '권역',
}
const MEASURE_LABEL: Record<Measure, string> = {
  supply: '판매금액',
  qty: '수량',
  cost: '매출원가',
  profit: '매출이익',
  costed: '원가 반영 매출',
}
const MEASURE_INDEX: Record<Measure, number> = { qty: 2, supply: 3, cost: 4, profit: 5, costed: 6 }

interface Preset {
  id: string
  label: string
  rows: Field[]
  measures: Measure[]
  exclude?: string[]
  channel?: string
  teams?: string[]
  items?: string[]
  sources?: string[]
}

// 구글시트 '26년 매출자료 조회' 조회 탭 피벗 정의를 그대로 옮김 (월·품명 같은 임시 선택 필터는 화면에서 고름)
const EXCL = ['운송비', '소모품', '서비스']
const RETAIL4 = ['매장영업팀', '영업1팀', '영업기획팀', '화장품사업팀']
const PRESETS: Preset[] = [
  { id: 'q3', label: '조회3 부서매출별', rows: ['sales_team'], measures: ['supply'], exclude: ['운송비', '소모품', 'a/s부품', '원자재', '서비스'] },
  { id: 'q4', label: '조회4 영업점별', rows: ['channel_type', 'customer_name', 'item_category'], measures: ['supply', 'cost'], exclude: [...EXCL, '(빈값)'], channel: '영업점', sources: ['국내'] },
  { id: 'q5', label: '조회5 부서연결 영업점별', rows: ['sales_team', 'item_category', 'customer_name'], measures: ['cost', 'supply'], exclude: EXCL, channel: '영업점', sources: ['국내'] },
  { id: 'q6', label: '조회6 유통사업본부', rows: ['sales_team', 'customer_name', 'item_name'], measures: ['supply', 'qty', 'cost', 'profit'], exclude: [...EXCL, '(빈값)'], channel: '영업점', teams: RETAIL4, sources: ['국내'] },
  { id: 'q7', label: '조회7 품목·거래처별', rows: ['sales_team', 'item_category', 'item_name', 'customer_name'], measures: ['supply', 'qty'], exclude: EXCL, teams: RETAIL4, sources: ['국내'] },
  { id: 'dairy', label: '유제품', rows: ['item_name', 'customer_name'], measures: ['qty', 'supply'], items: ['와일드오차드 스트링치즈150g', '와일드오차드 유기농우유 900ml'] },
  { id: 'export', label: '수출 (해외영업팀)', rows: ['item_name'], measures: ['qty', 'supply'], teams: ['해외영업팀'], sources: ['수출'] },
]

interface Node {
  key: string
  label: string
  depth: number
  values: Map<string, number>
  total: number
  children: Node[]
}

function newNode(key: string, label: string, depth: number): Node {
  return { key, label, depth, values: new Map(), total: 0, children: [] }
}

function add(n: Node, month: string, v: number) {
  n.values.set(month, (n.values.get(month) ?? 0) + v)
  n.total += v
}

// 행키 경로로 트리를 만들고 단계마다 소계를 누적
function buildTree(rows: PivotRow[], measure: Measure, query: string): Node {
  const root = newNode('', '총계', -1)
  const index = new Map<string, Node>()
  const q = query.trim().toLowerCase()
  const mi = MEASURE_INDEX[measure]
  for (const r of rows) {
    const keys = r[0]
    if (q && !keys.some((k) => k.toLowerCase().includes(q))) continue
    const month = r[1]
    const v = Number(r[mi] ?? 0)
    let parent = root
    let path = ''
    keys.forEach((k, depth) => {
      path += '\u0001' + k
      let n = index.get(path)
      if (!n) {
        n = newNode(path, k, depth)
        index.set(path, n)
        parent.children.push(n)
      }
      add(n, month, v)
      parent = n
    })
    add(root, month, v)
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => b.total - a.total)
    n.children.forEach(sort)
  }
  sort(root)
  return root
}

function flatten(n: Node, expanded: Set<string>, out: Node[] = []): Node[] {
  for (const c of n.children) {
    out.push(c)
    if (expanded.has(c.key)) flatten(c, expanded, out)
  }
  return out
}

function allParents(n: Node, out: string[] = []): string[] {
  for (const c of n.children) {
    if (c.children.length) {
      out.push(c.key)
      allParents(c, out)
    }
  }
  return out
}

export function PivotView({ months, teams, provMonths }: { months: string[]; teams: string[]; provMonths: Set<string> }) {
  const [presetId, setPresetId] = useState(PRESETS[0].id)
  const preset = PRESETS.find((p) => p.id === presetId)!
  const [from, setFrom] = useState(months[0] ?? '')
  const [to, setTo] = useState(months[months.length - 1] ?? '')
  const [measure, setMeasure] = useState<Measure>(preset.measures[0])
  const [teamSel, setTeamSel] = useState<string[]>(preset.teams ?? [])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<PivotRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = (p: Preset) => {
    setPresetId(p.id)
    setMeasure(p.measures[0])
    setTeamSel(p.teams ?? [])
    setExpanded(new Set())
    setQuery('')
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    getPivot({
      rows: preset.rows,
      from: from || null,
      to: to || null,
      exclude: preset.exclude,
      channel: preset.channel,
      teams: teamSel.length ? teamSel : null,
      items: preset.items,
      sources: preset.sources,
    })
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [preset, from, to, teamSel])

  const tree = useMemo(() => buildTree(rows, measure, query), [rows, measure, query])
  const visible = useMemo(() => flatten(tree, expanded), [tree, expanded])
  const cols = months.filter((m) => (!from || m >= from) && (!to || m <= to))
  // 원가·이익·원가반영매출만 가결산 영향을 받음 (판매금액·수량은 확정 값)
  const costMeasure = measure === 'cost' || measure === 'profit' || measure === 'costed'
  const provCls = (m: string) => (costMeasure && provMonths.has(m) ? 'num prov' : 'num')
  const provTotal = costMeasure && cols.some((m) => provMonths.has(m))
  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleTeam = (t: string) => setTeamSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))

  const fixed = [
    preset.sources && `출처: ${preset.sources.join(', ')}`,
    preset.channel && `영업점구분: ${preset.channel}`,
    preset.exclude && `자산분류 제외: ${preset.exclude.join(', ')}`,
    preset.items && `품명: ${preset.items.join(', ')}`,
  ].filter(Boolean)

  return (
    <div className="pivot">
      <div className="chips">
        {PRESETS.map((p) => (
          <button key={p.id} className={`chip ${p.id === presetId ? 'active' : ''}`} onClick={() => choose(p)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="pivot-controls">
        <label className="select">
          <span className="muted small">기간</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <span className="muted">~</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <div className="chips">
          {(Object.keys(MEASURE_LABEL) as Measure[]).map((m) => (
            <button key={m} className={`chip small ${m === measure ? 'active' : ''}`} onClick={() => setMeasure(m)}>
              {MEASURE_LABEL[m]}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="거래처·품명 등 검색" />
        </label>
      </div>

      <div className="chips team-chips">
        <span className="muted small">부서</span>
        <button className={`chip small ${teamSel.length === 0 ? 'active' : ''}`} onClick={() => setTeamSel([])}>
          전체
        </button>
        {teams.map((t) => (
          <button key={t} className={`chip small ${teamSel.includes(t) ? 'active' : ''}`} onClick={() => toggleTeam(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="pivot-meta">
        <span className="muted small">
          행: {preset.rows.map((f) => FIELD_LABEL[f]).join(' > ')}
          {fixed.length > 0 && ` · ${fixed.join(' · ')}`}
        </span>
        {preset.rows.length > 1 && (
          <span className="pivot-actions">
            <button className="btn ghost small" onClick={() => setExpanded(new Set(allParents(tree)))}>모두 펼치기</button>
            <button className="btn ghost small" onClick={() => setExpanded(new Set())}>모두 접기</button>
          </span>
        )}
      </div>

      {error && <div className="alert glass">조회 실패: {error}</div>}

      <div className={`table-scroll pivot-scroll ${loading ? 'refreshing' : ''}`}>
        <table className="pivot-table">
          <thead>
            <tr>
              <th>{preset.rows.map((f) => FIELD_LABEL[f]).join(' / ')}</th>
              {cols.map((m) => (
                <th key={m} className="num">
                  {monthLabel(m)}
                  {provMonths.has(m) && <span className="badge-prov" title="원가 미확정: 품목별 최근 확정 원가로 계산">가결산</span>}
                </th>
              ))}
              <th className="num">합계</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td className="empty" colSpan={cols.length + 2}>
                  {loading ? <RefreshCw size={18} className="spin" /> : '데이터가 없습니다'}
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
                {cols.map((m) => (
                  <td key={m} className={provCls(m)}>{n.values.has(m) ? fmtNumber(n.values.get(m)!) : ''}</td>
                ))}
                <td className={`num strong ${provTotal ? 'prov' : ''}`}>{fmtNumber(n.total)}</td>
              </tr>
            ))}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr>
                <td className="pivot-label">총계</td>
                {cols.map((m) => (
                  <td key={m} className={provCls(m)}>{fmtNumber(tree.values.get(m) ?? 0)}</td>
                ))}
                <td className="num">{fmtNumber(tree.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="muted small">
        구글시트 조회 탭의 피벗 설정을 옮긴 화면입니다. 원가가 확정되지 않은 달(가결산)의 매출원가·매출이익은
        품목별 가장 최근 확정 원가로 계산한 값입니다. 원가 이력이 없는 선물세트는 구성품 원가 합, 그 밖의 품목은 최근 구매단가로 추정하고,
        운송비·식음료 기타·a/s·적립금차감은 원가 0으로 포함합니다. 구매 기록도 없는 품목만 원가·이익에서 빠집니다.
      </p>
    </div>
  )
}
