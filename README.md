# 매출 실적 대시보드

Vite + React(TypeScript) + Recharts + lucide-react. Supabase 집계 View 4종(`v_sales_monthly_team / channel / item / customer`)을 anon 키로 조회한다.

## 로컬 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # dist/ 생성 (clean → tsc → vite build)
```

## Vercel 배포

- Root Directory: `dashboard`
- Framework Preset: Vite (vercel.json에 지정됨), Output: `dist`
- 선택 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (미지정 시 코드 내 기본값 사용)

## 참고

- 비밀번호 잠금은 클라이언트 측 화면 잠금이다. 번들에는 비밀번호의 SHA-256 해시만 들어가지만, anon 키는 공개되므로 실제 데이터 보호는 Supabase RLS가 담당한다.
- `scripts/clean.mjs`: Windows의 한글 경로에서 Node 24 `fs.rmSync({recursive})` / Vite `emptyOutDir`가 크래시하는 문제를 우회하기 위한 dist 삭제 스크립트.
