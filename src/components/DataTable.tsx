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
              {columns.map((c) => (
                <th key={c.key} className={c.align === 'right' ? 'num' : ''} onClick={() => toggle(c.key)}>
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
                {columns.map((c) => (
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
