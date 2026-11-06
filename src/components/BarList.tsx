import { fmtCompact } from '../lib/format'

export interface BarItem {
  label: string
  value: number
  count: number
  color: string
}

/** 가로 막대 목록: 금액 · 품목 수 */
export function BarList({ items, unit = '품목' }: { items: BarItem[]; unit?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <ul className="barlist">
      {items.map((i) => (
        <li key={i.label}>
          <span className="barlist-label muted">{i.label}</span>
          <span className="barlist-track">
            <span className="barlist-fill" style={{ width: `${(i.value / max) * 100}%`, background: i.color }} />
          </span>
          <span className="barlist-value">{fmtCompact(i.value)}원 · {i.count.toLocaleString()}{unit}</span>
        </li>
      ))}
    </ul>
  )
}
