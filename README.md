# PaperGraph3D

> ⚠️ **개발 중 (Work in Progress)** — 이 프로젝트는 초기 개발 단계입니다.
> 아직 사용 가능한 릴리스가 없으며, 구조·API·데이터 모델이 예고 없이 변경될 수 있습니다.

An Obsidian community plugin (in early development).

## 현재 상태 (Status)

이 저장소는 아직 뼈대를 잡아가는 단계입니다.

- 플러그인 진입점(`src/main.ts`, `src/settings.ts`)과 `manifest.json`은 아직 Obsidian sample plugin 템플릿 상태입니다.
- 첫 기능의 산출물인 코어 데이터 모델은 `src/models/`(`subscription`, `paper`, `settings`)에 구현되어 있습니다 (`specs/001-core-data-models`).

기능이 갖춰지는 대로 이 README를 업데이트할 예정입니다.

## 개발 (Development)

```bash
npm install     # 의존성 설치
npm run dev     # esbuild watch: src/main.ts -> main.js
npm run build   # 타입 체크 후 프로덕션 번들
npm run lint    # eslint
```

Obsidian에서 직접 시험하려면 `main.js`, `manifest.json`, `styles.css`를
`<Vault>/.obsidian/plugins/<plugin-id>/` 에 복사한 뒤 Obsidian을 리로드하고
설정 → 커뮤니티 플러그인에서 활성화하세요.

프로젝트 규약과 아키텍처는 `CLAUDE.md` 와 `AGENTS.md` 를 참고하세요.

## License

[MIT](LICENSE) © AKZIL
