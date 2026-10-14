# Dealmate 홈페이지

흰색과 코발트 블루, 큰 글자, 단계별 설명을 중심으로 구성한 소개 홈페이지입니다. 선택한 버전과 배포 방법은 [저장소 안내](../README.md)를 참조합니다.

저장소 루트에서 `npm ci --ignore-scripts`를 한 번 실행한 뒤, 루트 또는 이 폴더에서 `npm run dev`를 실행하면 <http://localhost:4174/>에서 미리 볼 수 있습니다. Node.js 24를 사용합니다. Google Cloud의 승인된 JavaScript 원본에는 로컬 테스트용 `http://localhost`와 `http://localhost:4174`를 등록합니다.

`public/`이 홈페이지입니다. 단계 선택은 서비스 구상을 설명하는 화면 전환이며 실제 AI 기능은 아닙니다. 상품 그림과 메모는 설명용 구상도이고 실제 매물, 판매자 답변 또는 실적이 아닙니다.

미리보기 서버는 이 컴퓨터에서만 접근할 수 있습니다. `npm run build`는 `public/` 원본을 `dist/`로 빌드하고, 미리보기 실행 때도 같은 빌드를 수행합니다. 실제 배포 파일은 `dist/`이며 개발 문서와 서버 소스는 정적 홈페이지로 제공하지 않습니다.

## 검색·공유 정보

공개 문구·대표주소·FAQ·작성자·내용 갱신일의 정본은 `public/index.html`입니다. `scripts/build.mjs`가 이 원문에서 OG/Twitter 메타태그, Organization·WebSite·WebPage·FAQPage JSON-LD, `sitemap.xml`, `robots.txt`, `llms.txt`를 생성합니다. `dist/`는 직접 편집하지 않습니다. 날짜는 실제 내용을 고친 날에만 원문에서 바꾸며 매 빌드마다 오늘 날짜로 갱신하지 않습니다.

사이트맵은 대표 홈페이지 1개만 포함합니다. 인증 API는 robots에서 제외하고 `X-Robots-Tag: noindex, nofollow`도 설정합니다. 이것은 접근 제어가 아니며 인증 검증은 기존 서버에서 그대로 처리합니다. 이름과 이메일 등 로그인 데이터는 검색용 산출물에 들어가지 않습니다.

로고 이미지 두 개는 바로 옆 브랜드 텍스트 및 링크의 접근성 이름과 중복되므로 빈 `alt`를 유지합니다. 설명용 SVG는 장식으로 숨기고 그림 아래 설명을 제공합니다. 공유용 PNG와 그 대체 설명은 빌드된 메타태그에 포함됩니다.

FAQPage는 [Schema.org](https://schema.org/FAQPage) 형식으로 실제 FAQ와 일치시킵니다. [Google 공식 변경 기록](https://developers.google.com/search/updates)에 따르면 FAQ 리치 결과는 2026-05-07부터 중단되었으며, llms.txt는 Google 검색 노출·순위에 영향을 주지 않습니다. llms.txt는 수업에서 요구한 원문 안내 용도입니다. 검색 등록과 색인·노출·AI 인용은 별도로 확인해야 합니다.

## Google 로그인

Google Identity Services의 팝업 버튼을 사용합니다. 공개 클라이언트 ID와 허용 사이트 목록은 [서버 설정](../server/auth.mjs) 한 곳에서 관리하며, 브라우저는 `/api/auth`에서 ID와 일회용 nonce를 받습니다. Google 스크립트는 로그인 창을 열 때 불러옵니다.

Google 공식 라이브러리로 서명·대상·발급자·만료·이메일 확인 상태를 검증하고, 로그인 요청의 nonce 및 출처도 확인합니다. 검증된 Google ID 토큰은 최대 1시간의 HttpOnly·SameSite 쿠키로 사용하며 운영 환경에서는 Secure·__Host 접두사를 적용합니다. 토큰·비밀값을 로컬 저장소나 로그에 기록하지 않습니다. 사용자 이름과 이메일은 로그인 상태 표시용으로만 반환하고 별도 회원 DB에 저장하지 않습니다.

로그아웃은 현재 브라우저의 Dealmate 쿠키를 지웁니다. Google 계정 자체의 로그아웃이나 Google 접근 동의 철회는 하지 않습니다. 별도 회원 데이터 저장·계정 관리·민감한 회원 전용 기능을 추가할 때에는 세션 폐기와 데이터 보관 정책을 함께 설계해야 합니다.

루트에서 `npm test`로 인증 검증 테스트를 실행합니다. 실제 Google 계정 로그인은 승인된 원본 설정 후 브라우저에서 별도로 확인해야 하며, 테스트의 서명된 가상 토큰은 Google 실제 계정 로그인의 증거가 아닙니다.
