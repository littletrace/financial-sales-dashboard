import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { MessageCircle, RotateCcw, Send, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface Call { name: string; input: Record<string, unknown> }
interface Msg { role: 'user' | 'assistant'; content: string; calls?: Call[] }

const EXAMPLES = ['이번 달 부서별 매출과 목표 달성률 알려줘', '올해 매출 상위 거래처 10곳은?', '지난달 이익률이 가장 낮은 부서는?']

/** 대시보드 데이터에 대해 질문하는 AI 채팅 (api/chat.ts) */
export function ChatPanel() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    setError('')
    // 로그인 토큰으로 인증. 서버는 이 토큰(사용자 권한)으로 DB를 조회함
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? ''
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // 서버 한도(21개)에 맞춰 최근 대화만 보냄. 홀수 개라 항상 질문으로 시작
      body: JSON.stringify({ messages: next.slice(-21).map(({ role, content }) => ({ role, content })) }),
    }).catch(() => null)
    const body = await r?.json().catch(() => null)
    setBusy(false)
    if (!r?.ok) {
      setMsgs(msgs) // 실패한 질문은 대화에서 빼고 입력창에 되돌림
      setInput(q)
      setError(body?.error ?? '서버에 연결할 수 없습니다')
      return
    }
    setMsgs([...next, { role: 'assistant', content: body.text || '(빈 답변)', calls: body.calls }])
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    ask(input)
  }

  // Enter 전송, Shift+Enter 줄바꿈 (한글 조합 중 Enter는 무시)
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="AI에게 질문">
        <MessageCircle size={22} />
      </button>
    )
  }

  return (
    <aside className="chat-panel glass" aria-label="AI 질문">
      <div className="chat-head">
        <strong>AI 질문</strong>
        <span className="muted small">DB 조회 결과로만 답합니다</span>
        <button className="btn ghost small" onClick={() => { setMsgs([]); setError('') }} title="새 대화" disabled={busy}>
          <RotateCcw size={14} />
        </button>
        <button className="btn ghost small" onClick={() => setOpen(false)} aria-label="닫기">
          <X size={14} />
        </button>
      </div>

      <div className="chat-log">
        {msgs.length === 0 && (
          <div className="chat-examples">
            {EXAMPLES.map((q) => (
              <button key={q} className="btn ghost small" onClick={() => ask(q)}>{q}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <p>{m.content}</p>
            {!!m.calls?.length && (
              <details className="muted small">
                <summary>조회 {m.calls.length}건</summary>
                {m.calls.map((c, j) => <code key={j}>{c.name} {JSON.stringify(c.input)}</code>)}
              </details>
            )}
          </div>
        ))}
        {busy && <div className="chat-msg assistant muted">조회 중…</div>}
        <div ref={end} />
      </div>

      <form className="chat-form" onSubmit={submit}>
        {error && <p className="run-error" role="alert">{error}</p>}
        <div className="chat-input">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="예: 9월 영업1팀 매출 상위 품목은?"
            rows={2}
            maxLength={4000}
            autoFocus
          />
          <button className="btn" disabled={busy || !input.trim()} aria-label="보내기">
            <Send size={15} />
          </button>
        </div>
      </form>
    </aside>
  )
}
