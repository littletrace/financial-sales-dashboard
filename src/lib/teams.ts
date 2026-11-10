// 부서 표시 기준 (DB 원본은 그 달 부서명 그대로, 화면에서만 현재 부서로 합침)
// 부서가 바뀌면 이 파일만 고치면 됨. 점검: node --experimental-strip-types scripts/check-pivot.ts

/** 없어진 부서 → 매출을 합칠 현재 부서 (화면에 '당시 ○○ 매출' 안내가 뜸) */
export const TEAM_MERGE: Record<string, string> = {
  유통사업팀: '영업1팀',
  화장품사업팀: '영업2팀',
  해외영업팀: '영업2팀',
  '온라인.구독영업팀': '영업3팀',
}
/** 이름만 바꿔 보여줄 부서 (안내 없음) */
const TEAM_RENAME: Record<string, string> = { 개미네사업본부: '개미네', '영업운영팀(HCL)': 'HCL 영업운영팀' }

/** 본부 → 소속 부서 (현재 부서명). 여기 없는 부서는 '기타' */
export const HQ: [string, string[]][] = [
  ['HCL사업본부', ['HCL 영업운영팀']],
  ['유통사업본부', ['영업기획팀', '영업1팀', '영업2팀', '영업3팀', '매장영업팀']],
  ['개미네사업본부', ['개미네']],
]
export const HQ_ETC = '기타'

export const NO_TEAM = '부서 미분류'
// DB 부서가 비어 있는 행(부서 규칙에 안 걸린 옛 매출 등)은 '부서 미분류'로. null이면 부서 정렬에서 화면 전체가 멈춤
export const currentTeam = (t: string | null) => (t ? TEAM_MERGE[t] ?? TEAM_RENAME[t] ?? t : NO_TEAM)

/** 현재 부서명 → DB에 있는 부서명들 (DB 조회 조건용) */
export const dbTeams = (teams: string[]) => {
  const all = [...Object.keys(TEAM_MERGE), ...Object.keys(TEAM_RENAME)]
  return [...new Set(teams.flatMap((t) => [t, ...all.filter((o) => currentTeam(o) === t)]))]
}

export function hqOf(team: string): { hq: string; rank: number } {
  const i = HQ.findIndex(([, ts]) => ts.includes(team))
  return i < 0 ? { hq: HQ_ETC, rank: HQ.length } : { hq: HQ[i][0], rank: i }
}
