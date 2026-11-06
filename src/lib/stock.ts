// 장기재고 구간 · 유통기한 상태 (화면 공통)

export const BUCKETS = [
  { label: '90~180일', max: 180, color: '#b3d4fc', tag: 'tag-yel' },
  { label: '180일~1년', max: 365, color: '#7fb3fa', tag: 'tag-org' },
  { label: '1~2년', max: 730, color: '#3182f6', tag: 'tag-red' },
  { label: '2년 이상', max: Infinity, color: '#1b64da', tag: 'tag-red' },
] as const

/** 미출고일수 → 구간 번호 (영림원 조회 조건이 90일 초과라 90 이하는 첫 구간에 넣음) */
export const bucketOf = (days: number | null) => {
  const i = BUCKETS.findIndex((b) => (days ?? 0) <= b.max)
  return i < 0 ? BUCKETS.length - 1 : i
}

/** 남은 일수 → 상태: 지남 / 30일 이내 임박 / 90일 이내 주의 / 180일 이내 관찰 / 정상 */
export function expiryStatus(daysLeft: number) {
  if (daysLeft < 0) return { label: '지남', tag: 'tag-red' }
  if (daysLeft <= 30) return { label: '임박', tag: 'tag-red' }
  if (daysLeft <= 90) return { label: '주의', tag: 'tag-org' }
  if (daysLeft <= 180) return { label: '관찰', tag: 'tag-yel' }
  return { label: '정상', tag: 'tag-grn' }
}

/** 표를 CSV(엑셀용 BOM 포함)로 내려받기 */
export function downloadCsv(name: string, head: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => (v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const body = [head, ...rows].map((r) => r.map(esc).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
