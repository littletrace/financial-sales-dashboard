const krw = new Intl.NumberFormat('ko-KR')

export const fmtNumber = (v: number) => krw.format(Math.round(v))

export const fmtWon = (v: number) => `₩${krw.format(Math.round(v))}`

// 억/만 단위 축약 (차트 축, KPI 보조표기용)
export function fmtCompact(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e8) return `${(v / 1e8).toFixed(abs >= 1e10 ? 0 : 1)}억`
  if (abs >= 1e4) return `${krw.format(Math.round(v / 1e4))}만`
  return krw.format(Math.round(v))
}

export const fmtPct = (v: number | null) => (v === null || !Number.isFinite(v) ? '-' : `${v.toFixed(1)}%`)

export const rate = (profit: number, supply: number) => (supply === 0 ? null : (profit / supply) * 100)

export const monthLabel = (m: string) => `${Number(m.slice(5, 7))}월`
