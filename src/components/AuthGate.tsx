import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BarChart3 } from 'lucide-react'
import { supabase, toLoginEmail } from '../lib/supabase'

/** 로그인 세션이 있을 때만 children 을 보여준다. 역할(app_metadata.role)별 화면 분기는 이후 여기서 session 을 넘겨 처리 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null // 저장된 세션 확인 중
  return session ? <>{children}</> : <Login />
}

function Login() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setMsg('')
    const { error } = await supabase.auth.signInWithPassword({
      email: toLoginEmail(String(f.get('id'))),
      password: String(f.get('password')),
    })
    setBusy(false)
    if (error) setMsg(error.message === 'Invalid login credentials' ? '아이디 또는 비밀번호가 틀렸습니다' : error.message)
  }

  return (
    <main className="login">
      <form className="run-dialog login-card" onSubmit={submit}>
        <div className="brand">
          <div className="brand-mark"><BarChart3 size={20} /></div>
          <h1>매출 실적 대시보드</h1>
        </div>
        <label>아이디
          <input name="id" required autoComplete="username" autoFocus />
        </label>
        <label>비밀번호
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        {msg && <p className="run-error" role="alert">{msg}</p>}
        <button className="btn" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
      </form>
    </main>
  )
}
