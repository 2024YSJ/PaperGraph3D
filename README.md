# PaperGraph3D

> ⚠️ **개발 중 (Work in Progress)** — 이 프로젝트는 초기 개발 단계입니다.
> 아직 사용 가능한 릴리스가 없으며, 구조·API·데이터 모델이 예고 없이 변경될 수 있습니다.

An Obsidian community plugin (in early development).

## 현재 상태 (Status)

이 저장소는 아직 뼈대를 잡아가는 단계입니다.

- 플러그인 진입점(`src/main.ts`, `src/settings.ts`)과 `manifest.json`은 아직 Obsidian sample plugin 템플릿 상태입니다.
- 첫 기능의 산출물인 코어 데이터 모델은 `src/models/`(`subscription`, `paper`, `settings`)에 구현되어 있습니다 (`specs/001-core-data-models`).

기능이 갖춰지는 대로 이 README를 업데이트할 예정입니다.

## 네트워크 사용 고지 (Network Use Disclosure)

구독 기반 논문 수집 기능(`specs/002-subscription-paper-collection`)은 이 플러그인에서 **유일하게 외부 네트워크를 사용하는** 기능입니다.

- **호출 대상 (What it calls):**
  - **arXiv API** (`export.arxiv.org`) — 등록한 구독 조건(키워드/저자/카테고리)에 맞는 새 논문을 **검색**합니다. 논문 발견은 arXiv에서만 이루어집니다.
  - **Semantic Scholar API** (`api.semanticscholar.org`) — arXiv에서 발견한 논문의 **인용 수·참고문헌 정보만** 보강합니다. 논문 검색에는 사용되지 않습니다.
- **언제 실행되는가 (When it runs):** 구독을 **하나 이상 등록한 뒤에만** 동작합니다. 구독이 없으면 어떤 네트워크 호출도 일어나지 않습니다(기본적으로 꺼진 상태 / opt-in by construction).
- **전송되는 데이터 (What is sent):** 검색어(구독 값)와 arXiv 논문 ID만 전송합니다. Vault의 노트 내용은 전송되지 않습니다.
- **선택적 Semantic Scholar API 키 (Optional API key):** 설정의 `semanticScholarApiKey`는 **선택 사항**이며, 지정 시 전용 요청 한도(rate limit)를 얻기 위한 용도일 뿐 **필수가 아닙니다**. 키가 없어도 인용 정보 보강은 공용(익명) 한도 내에서 그대로 동작합니다.

---

The subscription-based paper collection feature is the **only** part of this plugin that makes external network calls:

- **arXiv API** — discovers new papers matching your registered subscriptions (arXiv is the sole discovery source).
- **Semantic Scholar API** — enriches discovered papers with citation counts and references only; never used for discovery.
- Runs **only after you register at least one subscription** (no subscriptions → no network calls; opt-in by construction).
- Only search terms and arXiv paper IDs are sent — never your note contents.
- The optional `semanticScholarApiKey` setting is never required; it only grants a dedicated rate limit when present.

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
