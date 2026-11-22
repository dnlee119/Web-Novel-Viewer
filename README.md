# Web Novel Viewer

웹소설 뷰어 프로젝트입니다.

## GitHub에서 작업 관리

- 작업 내용과 완료 기준은 GitHub Issues에 기록합니다.
- 이슈별 브랜치에서 작업하고 `main`으로 Pull Request를 엽니다. PR 본문에 `Closes #이슈번호`를 넣으면 병합할 때 이슈가 함께 닫힙니다.
- 배포 결과와 배포 주소는 저장소의 Actions 탭에서 `Deploy to GitHub Pages` 실행을 열어 확인할 수 있습니다.

## GitHub Pages 배포

현재 워크플로는 `site/`의 정적 파일을 게시합니다. `site/index.html`을 진입점으로 추가하고 CSS, JavaScript, 이미지 경로에는 저장소 이름이 포함된 Pages 주소에서도 동작하도록 상대 경로를 사용합니다.

1. GitHub 저장소에서 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다. GitHub Free에서는 공개 저장소에서 Pages를 사용할 수 있습니다. 비공개 저장소의 Pages 지원 여부는 계정 요금제에 따라 달라집니다.
2. `site/` 변경이 `main`에 반영되면 자동 배포됩니다. 최초에 Pages 설정을 마친 뒤에는 Actions 탭에서 `Deploy to GitHub Pages`를 선택해 `main`에서 수동 실행할 수도 있습니다.
3. 프로젝트 사이트의 기본 주소는 `https://<사용자명>.github.io/<저장소명>/`입니다.
