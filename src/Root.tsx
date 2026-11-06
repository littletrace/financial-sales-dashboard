import { useState, useSyncExternalStore } from 'react'
import { BarChart3, CalendarClock, PackageSearch } from 'lucide-react'
import App from './App'
import { LongStockPage } from './pages/LongStockPage'
import { ExpiryPage } from './pages/ExpiryPage'

type Page = 'sales' | 'long' | 'expiry'
const MENU: { group: string; items: { id: Page; label: string; icon: typeof BarChart3 }[] }[] = [
  { group: '재무', items: [{ id: 'sales', label: '매출실적', icon: BarChart3 }] },
  { group: '재고', items: [{ id: 'long', label: '장기재고', icon: PackageSearch }, { id: 'expiry', label: '유통기한', icon: CalendarClock }] },
]

const NARROW = '(max-width: 640px)'
const subscribe = (cb: () => void) => {
  const mq = matchMedia(NARROW)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** 왼쪽 메뉴 + 페이지. 첫 화면은 매출실적. 휴대폰은 매출실적(모바일 화면)만 */
export default function Root() {
  const [page, setPage] = useState<Page>('sales')
  const narrow = useSyncExternalStore(subscribe, () => matchMedia(NARROW).matches)
  if (narrow) return <App />
  return (
    <div className="shell">
      <nav className="side" aria-label="메뉴">
        <div className="side-title">시즌글라스 대시보드</div>
        {MENU.map((g) => (
          <div key={g.group}>
            <div className="side-group">{g.group}</div>
            {g.items.map(({ id, label, icon: Icon }) => (
              <button key={id} className={page === id ? 'side-item active' : 'side-item'} aria-current={page === id ? 'page' : undefined}
                onClick={() => { setPage(id); scrollTo(0, 0) }}>
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="shell-main">
        {/* 매출실적은 숨겨도 유지 → 메뉴를 오가도 다시 불러오지 않음 */}
        <div hidden={page !== 'sales'}><App /></div>
        {page === 'long' && <div className="app"><LongStockPage /></div>}
        {page === 'expiry' && <div className="app"><ExpiryPage /></div>}
      </div>
    </div>
  )
}
