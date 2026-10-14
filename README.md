# Dealmate

중고 구매를 위한 AI 메이트를 구상하는 Dealmate의 소개 홈페이지입니다. 현재 아이디어 구체화 단계이며 정식 서비스는 제공하지 않습니다.

2026-10-03 사용자가 두 번째 디자인(`site2`)의 문구와 디자인을 확정하고 GitHub 업로드 및 Vercel 배포를 승인했습니다.

## 홈페이지 개발

선택한 홈페이지 소스와 로컬 미리보기 실행 방법은 [site2](site2/README.md)에 있습니다.

## 배포

GitHub `main` 브랜치를 Vercel 프로젝트에 연결합니다. 프로젝트의 Root Directory는 저장소 루트(`./`)이며, [vercel.json](vercel.json)에서 패키지 설치, 빌드 명령과 정적 파일 경로를 지정합니다. 홈페이지 원본·빌드·검색 메타데이터 안내는 [site2 개발 안내](site2/README.md)를 참조합니다. Google 로그인 검증은 `api/auth.js`의 Vercel Function이 담당합니다. Google Client Secret이나 별도 데이터베이스는 사용하지 않습니다.

홈페이지 문구 및 가격 변경은 사용자의 확정 후 게시합니다. 이전 배포로 돌아가야 할 경우 Vercel 배포 기록에서 이전 버전을 복원하거나 해당 코드 변경을 Git에서 되돌려 배포합니다.
