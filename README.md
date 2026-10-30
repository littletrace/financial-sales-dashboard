# 매출 실적 대시보드

Vite + React(TypeScript) + Recharts + lucide-react. Supabase 집계 View 4종(`v_sales_monthly_team / channel / item / customer`)을 anon 키로 조회한다.

## 로컬 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # dist/ 생성 (clean → tsc → vite build)
```

## Vercel 배포

- Root Directory: 저장소 루트(기본값)
- Framework Preset: Vite (vercel.json에 지정됨), Output: `dist`
- 선택 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (미지정 시 코드 내 기본값 사용)

## 참고

- 로그인: Supabase Auth. 아이디는 `아이디@dashboard.local` 이메일로 바꿔 로그인한다 (`src/lib/supabase.ts` `toLoginEmail`).
- 데이터 보호는 Supabase RLS: `fct_sales`·`dim_sales_target` 은 로그인 + `app_metadata.role` 이 있는 사용자만 읽음 (`dashboard_role()`). anon 키는 번들에 공개되어도 데이터 조회 불가.
- 계정 추가·역할 지정: Supabase 대시보드 Authentication → Users 에서 `아이디@dashboard.local` 로 생성 후 SQL `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where email = '...'`. role 이 없으면 로그인은 돼도 데이터가 안 보인다.
- `scripts/clean.mjs`: Windows의 한글 경로에서 Node 24 `fs.rmSync({recursive})` / Vite `emptyOutDir`가 크래시하는 문제를 우회하기 위한 dist 삭제 스크립트.
