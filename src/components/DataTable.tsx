import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'

export interface Column<T> {
  key: keyof T & string
  label: string
  align?: 'left' | 'right'
  render?: (row: T) => ReactNode
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  searchKeys: (keyof T & string)[]
  defaultSort: keyof T & string
  rank?: boolean
  note?: string
}

export function DataTable<T extends object>({ rows, columns, searchKeys, defaultSort, rank, note }: Props<T>) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<keyof T & string>(defaultSort)
  const [desc, setDesc] = useState(true)

  // 열 순서: 헤더를 끌어 옮기면 바뀌고, 이 브라우저에 기억한다 (열 구성이 같은 표끼리 같은 키)
  const orderKey = 'col-order:' + columns.map((c) => c.key).join(',')
  const [order, setOrder] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(orderKey) ?? '[]')
    } catch {
      return []
    }
  })
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const cols = useMemo(() => {
    const pos = (k: string, i: number) => (order.includes(k) ? order.indexOf(k) : 1000 + i) // 새로 생긴 열은 뒤로
    return columns.map((c, i) => [pos(c.key, i), c] as const).sort((a, b) => a[0] - b[0]).map(([, c]) => c)
  }, [columns, order])

  function moveColumn(from: string, to: string) {
    if (from === to) return
    const keys = cols.map((c) => c.key as string).filter((k) => k !== from)
    keys.splice(keys.indexOf(to), 0, from)
    setOrder(keys)
    try {
      localStorage.setItem(orderKey, JSON.stringify(keys))
    } catch {
      /* 저장 불가 환경이면 이번 화면에서만 유지 */
    }
  }

  const view = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)))
      : rows
    return [...filtered].sort((a, b) => {
      const x = a[sortKey]
      const y = b[sortKey]
      const cmp =
        typeof x === 'number' || typeof y === 'number'
          ? (typeof x === 'number' ? x : -Infinity) - (typeof y === 'number' ? y : -Infinity)
          : String(x ?? '').localeCompare(String(y ?? ''), 'ko')
      return desc ? -cmp : cmp
    })
  }, [rows, query, sortKey, desc, searchKeys])

  function toggle(key: keyof T & string) {
    if (key === sortKey) setDesc(!desc)
    else {
      setSortKey(key)
      setDesc(true)
    }
  }

  return (
    <div className="table-wrap">
      <div className="table-toolbar">
        <div className="search">
          <Search size={15} />
          <input placeholder="검색…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="muted small">
          {note ? `${note} · ` : ''}
          {view.length.toLocaleString()}건
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {rank && <th className="rank">#</th>}
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={[c.align === 'right' && 'num', dragKey === c.key && 'dragging', overKey === c.key && dragKey !== c.key && 'drop-target']
                    .filter(Boolean)
                    .join(' ')}
                  title="클릭: 정렬 · 끌기: 열 이동"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', c.key) // Firefox 는 데이터가 있어야 드래그 시작
                    e.dataTransfer.effectAllowed = 'move'
                    setDragKey(c.key)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setOverKey(c.key)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragKey) moveColumn(dragKey, c.key)
                  }}
                  onDragEnd={() => {
                    setDragKey(null)
                    setOverKey(null)
                  }}
                  onClick={() => toggle(c.key)}
                >
                  <span className="th-inner">
                    {c.label}
                    {sortKey === c.key ? (
                      desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />
                    ) : (
                      <ArrowUpDown size={13} className="dim" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((row, i) => (
              <tr key={i}>
                {rank && <td className="rank">{i + 1}</td>}
                {cols.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                    {c.render ? c.render(row) : String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {view.length === 0 && (
              <tr>
                <td colSpan={columns.length + (rank ? 1 : 0)} className="empty">
                  데이터가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
