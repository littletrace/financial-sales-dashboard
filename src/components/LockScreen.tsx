import { useState, type FormEvent } from 'react'
import { Lock, ArrowRight } from 'lucide-react'
import { checkPassword, saveAuth } from '../lib/auth'

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await checkPassword(value)
    setBusy(false)
    if (ok) {
      saveAuth()
      onUnlock()
    } else {
      setError(true)
      setValue('')
    }
  }

  return (
    <div className="lock">
      <form className={`lock-card glass ${error ? 'shake' : ''}`} onSubmit={submit} onAnimationEnd={() => setError(false)}>
        <div className="lock-icon">
          <Lock size={26} />
        </div>
        <h1>매출 대시보드</h1>
        <p className="muted">접근하려면 비밀번호를 입력하세요.</p>
        <div className="lock-input">
          <input
            type="password"
            autoFocus
            placeholder="비밀번호"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit" disabled={!value || busy} aria-label="잠금 해제">
            <ArrowRight size={18} />
          </button>
        </div>
        {error && <p className="lock-error">비밀번호가 올바르지 않습니다.</p>}
      </form>
    </div>
  )
}
