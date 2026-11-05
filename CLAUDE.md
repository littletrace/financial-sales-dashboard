# 매출 실적 대시보드 시스템

## 구성
영림원(K-System Ace) → finance-db-loader(GitHub Actions) → Supabase(재무DB) → financial-sales-dashboard(Vercel) + AI 질문(Claude API)

- finance-db-loader (비공개): `py/download_erp.py`(영림원 4개 화면 다운로드), `py/migrate_sales_data.py`(가공·적재), `기준표/*.csv`(거래처·권역·부서 규칙·세트·매출목표), `sql/`(DB 구조)
- financial-sales-dashboard (공개): 화면(`src/`), `api/run.ts`(DB적재 버튼 → erp.yml 실행), `api/chat.ts`(AI 질문)

## 데이터 정의
- 대시보드 매출 = 영림원 거래명세서품목조회(국내) + 수출매출품목조회. 제품·상품 판매만.
- 손익계산서 매출과 차이 나는 것은 정상: 공사수입·기타매출·임대수입·수수료수입은 대시보드 대상이 아님.
- 원가 = 재고금액상세조회의 품목단위당원가 × 수량. 재무 마감은 보통 2~3개월 뒤 → 최근 2~3개월은 '가결산'(최근 확정 원가로 임시 계산)이 정상.
- 세트추정: 원가 이력 없는 선물세트 = 구성품 원가 합. 구매가추정: 그 밖에 원가 없는 품목 = 최근 구매단가.
- 이익률 = 매출이익 ÷ 원가 반영 매출(원가 있는 행의 매출).
- 부서는 영림원 값이 아니라 DB 함수 classify_sales_team(거래처·품목 키워드 규칙, `sql/매출부서구분.sql`)으로 계산. 영림원 '부서'는 입력 부서(대부분 기획팀)라 쓰지 않는다.
- 권역은 영업점 거래처에만 있음(`기준표/권역구분.csv`). 그 외는 '권역 없음'이 정상.

## 규칙
- 영림원은 조회만 한다. 쓰기·저장 금지.
- 운영 DB 데이터를 직접 고치지 않는다. DB 적재(erp.yml 실행)는 사람이 대시보드 DB적재 버튼으로 한다.
- DB 구조 변경은 finance-db-loader `sql/migration_YYYYMMDD_설명.sql` 파일 + PR. 원격 DB 적용은 머지 후 사람이 한다. 기준선은 `sql/schema_baseline.sql`.
- main 직접 push 금지. 작업당 브랜치 + PR. 화면 변경은 PR 미리보기로, DB·적재 변경은 PR에 변경 전후 숫자 비교표 첨부.
- 비밀값은 GitHub Secrets / Vercel 환경변수에만.
- 이 저장소는 공개다. 금액·거래처·사내 자료를 코드나 문서에 넣지 않는다.

## 담당
- 책임자: 기획팀 (요구사항, 확인, 승인)
- 개발 담당: 전산 (검토, 반영, 서비스 설정)
