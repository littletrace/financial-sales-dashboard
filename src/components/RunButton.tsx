import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Play } from 'lucide-react'

// api/run.ts 의 REPORTS 와 같은 순서
const REPORTS = ['거래명세서품목조회', '수출매출품목조회', '재고금액상세조회', '손익계산서(월별)']
interface Run { status: string; conclusion: string | null; createdAt: string }

/** 영림원 다운로드 → DB 적재 실행 버튼. 실행 성공으로 끝나면 onDone(데이터 새로고침) 호출 */
export function RunButton({ onDone }: { onDone: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const wasActive = useRef(false)
  const since = useRef(0) // 방금 요청한 실행이 GitHub 에 생기기 전엔 이전 실행을 무시
  const [run, setRun] = useState<Run | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [picked, setPicked] = useState<string[]>(REPORTS)
  const all = picked.length === REPORTS.length
  const togglePick = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))

  const poll = useCallback(async () => {
    const r = await fetch('/api/run').catch(() => null)
    if (!r?.ok) return
    const next: Run | null = await r.json()
    if (next && Date.parse(next.createdAt) < since.current) return
    setRun(next)
  }, [])

  const active = !!run && run.status !== 'completed'
  useEffect(() => { poll() }, [poll])
  useEffect(() => {
    if (wasActive.current && !active && run?.conclusion === 'success') onDone()
    wasActive.current = active
    if (!active) return
    const t = setInterval(poll, 10_000)
    return () => clearInterval(t)
  }, [active, run, poll, onDone])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    setBusy(true)
    setMsg('')
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: f.get('password'), month: f.get('month'), reports: picked, load: true,
      }),
    }).catch(() => null)
    setBusy(false)
    if (!r?.ok) {
      setMsg((await r?.json().catch(() => null))?.error ?? '서버에 연결할 수 없습니다')
      return
    }
    form.reset()
    setPicked(REPORTS)
    since.current = Date.now() - 10_000 // PC·GitHub 시계 차이 여유
    dialog.current?.close()
    setRun({ status: 'queued', conclusion: null, createdAt: new Date().toISOString() })
    setTimeout(poll, 5000) // GitHub 에 실행이 생기기까지 몇 초 걸림
  }

  return (
    <>
      <button className="btn" onClick={() => dialog.current?.showModal()} disabled={active}>
        <Play size={15} className={active ? 'spin' : ''} />
        <span>{active ? 'DB적재 중…' : 'DB적재'}</span>
      </button>
      <dialog ref={dialog} className="run-dialog" onClose={() => setMsg('')}>
        <form onSubmit={submit}>
          <h3>영림원 다운로드 → DB 적재</h3>
          <label>조회 월 <span className="muted small">(비우면 매출 전월+당월, 재고 당월, 손익 1월~당월)</span>
            <input type="month" name="month" />
          </label>
          <fieldset className="report-picks">
            <legend>화면</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={all}
                ref={(el) => { if (el) el.indeterminate = picked.length > 0 && !all }}
                onChange={() => setPicked(all ? [] : REPORTS)}
              />
              전부
            </label>
            {REPORTS.map((n) => (
              <label key={n} className="check sub">
                <input type="checkbox" checked={picked.includes(n)} onChange={() => togglePick(n)} /> {n}
              </label>
            ))}
          </fieldset>
          <label>비밀번호
            <input type="password" name="password" required autoComplete="current-password" autoFocus />
          </label>
          {msg && <p className="run-error" role="alert">{msg}</p>}
          <div className="run-actions">
            <button type="button" className="btn ghost" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn" disabled={busy || !picked.length} title={picked.length ? undefined : '화면을 하나 이상 고르세요'}>
              {busy ? '요청 중…' : '실행'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
