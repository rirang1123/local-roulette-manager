# 로컬 룰렛 매니저 구현 계획

## 1. 목표

이 문서는 로컬 룰렛 매니저 MVP를 구현하기 위한 실행 계획이다. 기준 요구사항은 사용자가 제공한 기획서이며, 구현 중 아래 원칙을 최우선으로 둔다.

```text
서버형 서비스로 만들지 않는다.
외부 DB를 사용하지 않는다.
회원가입과 로그인을 만들지 않는다.
클라우드 저장과 동기화를 만들지 않는다.
SOOP 스트림키를 입력받거나 저장하지 않는다.
위플랩 URL을 외부로 전송하지 않는다.
사용자 PC 로컬 환경에서만 동작한다.
```

MVP의 핵심 산출물은 Electron 데스크톱 앱, 날짜별 JSON 로그 저장소, 로컬 API 서버, OBS 브라우저 독용 컨트롤 패널이다.

## 2. 권장 기술 스택

```text
Electron
React
TypeScript
Vite
Node.js fs
localhost API server
```

후보 라이브러리:

- `keytar`: OS 보안 저장소 사용
- `hono` 또는 Node 기본 HTTP 서버: 로컬 API 서버
- `archiver`: ZIP 백업 생성
- `csv-stringify`: CSV 백업 생성
- `date-fns`: 날짜 범위, 주간/월간 계산

Electron을 기본으로 하되, 구현은 로컬 파일과 localhost API에 닫힌 구조로 유지한다. API는 반드시 `127.0.0.1`에만 바인딩한다.

## 3. 프로젝트 구조

```text
src/
  main/
    index.ts
    monitor/
      weflab-monitor.ts
      network-detector.ts
      dom-detector.ts
      duplicate-guard.ts
      event-normalizer.ts
    storage/
      app-data.ts
      settings-store.ts
      event-store.ts
      mapping-store.ts
      filter-store.ts
      secure-url-store.ts
    server/
      local-api.ts
      auth.ts
      events-stream.ts
      obs-panel.ts
    backup/
      backup-service.ts
      csv-export.ts
      zip-export.ts
    retention/
      cleanup-service.ts
    tasks/
      heavy-task-queue.ts
      chunk-runner.ts
      timer-service.ts
  preload/
    index.ts
  renderer/
    app/
    pages/
      dashboard/
      all-events/
      unclassified/
      action/
      accumulation/
      tracked/
      timed/
      backup/
      settings/
      obs-panel/
    components/
    hooks/
    styles/
  shared/
    types.ts
    constants.ts
    date.ts
```

기존 표현인 리액션/운동/방셀은 UI 설명에는 보조적으로 쓸 수 있지만, 내부 타입과 파일명은 처리 방식 기준인 `action`, `accumulation`, `tracked`, `timed`를 사용한다.

## 4. 로컬 데이터 구조

Electron `app.getPath('userData')` 아래에 앱 데이터 폴더를 둔다.

```text
app-data/
  settings.json
  mappings.json
  filters.json
  logs/
    2026-05-15.json
    2026-05-16.json
  backups/
```

로그는 단일 파일에 모으지 않고 날짜별 JSON 파일로 저장한다. 파일 저장은 임시 파일에 먼저 쓴 뒤 rename하며, 필요하면 `.bak` 백업을 만든다.

저장 흐름:

```text
기존 날짜 파일 읽기
-> 새 이벤트 병합
-> 임시 파일 쓰기
-> 쓰기 완료 후 rename
-> 필요 시 기존 파일 .bak 생성
```

기간 조회, 합산, 백업, 자동 삭제는 모든 로그를 한 번에 메모리에 올리지 않고 날짜 파일 단위로 처리한다.

## 5. 공통 타입

```ts
export type RouletteCategory =
  | 'action'
  | 'accumulation'
  | 'tracked'
  | 'timed'
  | 'excluded'
  | 'unclassified';

export type RouletteStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'held'
  | 'canceled';

export type AccumulationPeriodType = 'none' | 'weekly' | 'monthly';

export interface RouletteEvent {
  id: string;
  nickname: string;
  value: number;
  roulette_content: string;
  category: RouletteCategory;
  status: RouletteStatus;
  received_at: string;
  memo?: string;
  raw_payload?: unknown;

  item_name?: string;
  amount?: number;
  unit?: string;
  period_type?: AccumulationPeriodType;

  timer_name?: string;
  duration_seconds?: number;
  remaining_seconds?: number;
  started_at?: string | null;
  ended_at?: string | null;
}
```

매핑 타입:

```ts
export type RouletteMapping =
  | { category: 'action' }
  | { category: 'tracked' }
  | { category: 'excluded' }
  | {
      category: 'accumulation';
      item_name: string;
      amount: number;
      unit: string;
      period_type: AccumulationPeriodType;
    }
  | {
      category: 'timed';
      timer_name: string;
      duration_seconds: number;
      auto_start: boolean;
    };
```

## 6. 위플랩 URL 보안

위플랩 URL은 민감 정보로 취급한다.

구현 우선순위:

1. `keytar`로 OS 보안 저장소에 저장한다.
2. 실패하거나 플랫폼 이슈가 있으면 로컬 설정 파일 fallback을 사용한다.
3. 어떤 경우에도 UI, preload API, localhost API, OBS 패널에서 원문 URL을 반환하지 않는다.

UI 표시 예:

```text
위플랩 URL: 등록됨
상태: 연결 대기 중
마지막 수신: 2026-05-15 21:30:12
```

금지 사항:

- 저장 후 원문 URL 재표시
- OBS 패널에 URL 표시
- API 응답에 URL 포함
- 외부 서버 전송

## 7. 모니터링 엔진

Electron main process에서 위플랩 후원알림 URL을 내부 `BrowserWindow` 또는 `webContents`로 로드한다.

감지 우선순위:

1. WebSocket 또는 네트워크 이벤트 감지
2. DOM `MutationObserver` 기반 감지

피할 방식:

- 짧은 주기의 전체 DOM polling
- 페이지 전체 텍스트 반복 스캔
- 무차별 `setInterval` 파싱

처리 흐름:

```text
모니터링 시작
-> 저장된 위플랩 URL 로드
-> 네트워크 감지 또는 DOM 감지 연결
-> nickname / value / roulette_content 추출
-> 이벤트 정규화
-> 중복 검사
-> mappings.json 기준 자동 분류
-> 날짜별 JSON 로그 저장
-> renderer와 OBS 패널에 상태 변경 알림
```

중복 기준:

```text
nickname + value + roulette_content + 3초 이내 received_at
```

최근 수십 개 이벤트만 중복 검사 캐시에 보관한다.

## 8. 분류 정책

분류 기준은 URL이 아니라 `roulette_content`다.

카테고리:

```text
action        즉시 처리형
accumulation  기간 누적형
tracked       후처리 추적형
timed         시간 제한형
excluded      제외
unclassified  미분류
```

처리 흐름:

```text
룰렛 이벤트 수신
-> roulette_content 확인
-> mappings.json 조회
-> 매핑 있음: category와 부가 정보 적용
-> 매핑 없음: unclassified / pending 저장
-> 사용자가 미분류 화면에서 분류
-> mappings.json 저장
-> 이후 동일 roulette_content 자동 분류
```

기본 상태:

- `action`: `pending`
- `tracked`: `pending`
- `timed`: `pending`, 단 `auto_start = true`이면 `running`
- `accumulation + period_type = none`: `completed`
- `accumulation + period_type = weekly/monthly`: `pending`
- `excluded`: `completed`
- `unclassified`: `pending`

`filters.json`의 tracked 키워드는 보조 수단으로만 사용하고, 직접 매핑을 우선한다.

## 9. Renderer UI

React 화면은 다음 메뉴로 구성한다.

```text
대시보드
전체 로그
미분류
즉시 처리형
기간 누적형
후처리 추적형
시간 제한형
백업
설정
```

### 9.1 대시보드

- 모니터링 상태
- 위플랩 URL 등록 여부
- 마지막 수신 시각
- 최근 룰렛 1개
- 즉시 처리형 대기 수
- 후처리 추적형 대기 수
- 시간 제한형 진행/대기 수
- 미분류 수
- 모니터링 시작/중지 버튼

### 9.2 전체 로그

컬럼:

```text
시간
닉네임
값
룰렛 내용
분류
상태
```

필터:

- 날짜
- 닉네임 검색
- 룰렛 내용 검색
- 분류
- 상태

기본 조회 범위는 오늘로 제한하고, 긴 목록은 pagination 또는 가상 스크롤을 사용한다.

### 9.3 미분류

`roulette_content`별로 묶어서 보여준다.

분류 버튼:

```text
즉시 처리형
기간 누적형
후처리 추적형
시간 제한형
제외
```

기간 누적형 추가 입력:

```text
항목명
수량
단위
기간: 없음 / 1주일 / 1개월
```

시간 제한형 추가 입력:

```text
타이머명
시간
자동 시작
```

### 9.4 즉시 처리형

- 상태 변경: 대기 / 완료 / 보류 / 취소
- 닉네임 검색
- 처리 내용 검색
- 날짜 필터
- OBS 패널에서 완료 처리 가능

### 9.5 기간 누적형

두 탭으로 구성한다.

합산 탭:

```text
항목명
합산 수량
단위
기간
```

조회 옵션:

```text
이번 주
지난 주
이번 달
지난 달
사용자 지정
```

로그 탭:

```text
시간
닉네임
값
원본 룰렛 내용
항목명
수량
단위
상태
```

합산은 별도 저장소를 만들지 않고 선택 기간의 로그 파일을 읽어 조회 시 계산한다.

### 9.6 후처리 추적형

- 상태 변경: 대기 / 완료 / 보류 / 취소
- 닉네임 검색
- 룰렛 내용 검색
- 상태 필터
- 날짜 필터
- OBS 패널에서 완료 처리 가능

### 9.7 시간 제한형

표시 영역:

- 진행 중 타이머
- 대기 타이머

기능:

- 시작
- 완료
- 취소
- 남은 시간 표시

MVP에서는 일시정지/재개는 후순위로 둔다. 타입에는 `paused`를 유지하되 첫 구현 범위에서는 UI에 노출하지 않아도 된다.

### 9.8 백업

- 시작일/종료일 선택
- 포함 데이터 선택
- 형식 선택: ZIP / CSV / JSON
- 기본값은 ZIP
- 백업 진행률과 취소 버튼 제공

### 9.9 설정

- 위플랩 URL 등록/재등록/삭제
- 로컬 API 포트 표시
- OBS 패널 URL 표시
- 데이터 보관 정책 안내
- 자동 삭제 설정 표시

## 10. 기간 누적형 합산

계산 흐름:

```text
선택 기간 산출
-> 해당 기간의 logs/YYYY-MM-DD.json 읽기
-> category = accumulation 필터
-> period_type 조건 필터
-> item_name + unit 기준 그룹화
-> amount 합산
```

주간 기준:

```text
월요일 00:00:00 ~ 일요일 23:59:59
```

월간 기준:

```text
매월 1일 00:00:00 ~ 말일 23:59:59
```

합산은 선택 기간에 대해서만 수행한다. 대시보드와 OBS 패널에서는 간단 요약만 계산한다.

## 11. 시간 제한형 타이머

타이머 이벤트 저장 예:

```json
{
  "id": "evt_20260515_215000_003",
  "nickname": "팬A",
  "value": 500,
  "roulette_content": "10분 동안 존댓말",
  "category": "timed",
  "status": "pending",
  "timer_name": "존댓말",
  "duration_seconds": 600,
  "remaining_seconds": 600,
  "started_at": null,
  "ended_at": null,
  "received_at": "2026-05-15T21:50:00+09:00"
}
```

타이머 흐름:

```text
timed 이벤트 수신
-> pending 저장
-> 사용자가 시작
-> running으로 변경
-> remaining_seconds 감소
-> 0초 도달 시 completed
```

타이머 상태는 main process의 `timer-service`에서 관리한다. renderer와 OBS 패널은 상태를 표시하고 명령만 보낸다.

## 12. localhost API

보안 조건:

- `127.0.0.1`에만 바인딩
- `0.0.0.0` 금지
- 모든 제어 API에 토큰 요구
- 위플랩 URL 원문 반환 금지

MVP API:

```text
GET  /api/status
POST /api/monitor/start
POST /api/monitor/stop
GET  /api/events/latest
GET  /api/action/pending
GET  /api/tracked/pending
GET  /api/accumulation/summary
GET  /api/timed/pending
GET  /api/timed/running
GET  /api/unclassified/count
POST /api/events/:id/status
POST /api/timed/:id/start
POST /api/timed/:id/complete
POST /api/backup/open
```

OBS 패널과 renderer 상태 갱신은 짧은 주기 polling보다 SSE 또는 WebSocket을 우선한다.

## 13. OBS 브라우저 독 패널

OBS 플러그인은 만들지 않는다. Electron 앱의 localhost 서버가 OBS용 HTML 패널을 제공한다.

예:

```text
http://127.0.0.1:17777/obs-panel?token=local-generated-token
```

기능:

- 모니터링 시작/중지
- 연결 상태 확인
- 마지막 수신 시각 확인
- 최근 룰렛 1개 표시
- 즉시 처리형 대기 항목 표시 및 완료 처리
- 후처리 추적형 대기 항목 표시 및 완료 처리
- 기간 누적형 합산 간단 표시
- 시간 제한형 진행/대기 항목 표시
- 시간 제한형 시작/완료 처리
- 미분류 항목 개수 표시
- 백업 화면 열기

OBS 패널은 방송 화면에 노출되는 브라우저 소스가 아니라 스트리머가 조작하는 브라우저 독이다.

## 14. 백업

백업은 사용자가 선택한 기간에 대해서만 수행한다.

흐름:

```text
시작일/종료일 선택
-> 기간 내 로그 파일 로드
-> 이벤트 병합
-> 카테고리별 분리
-> 기간 누적형 합산 생성
-> CSV/JSON 생성
-> ZIP 생성
-> 사용자 저장 위치 선택
```

ZIP 내부 구조:

```text
roulette_backup_YYYY-MM-DD_YYYY-MM-DD/
  raw_logs.json
  all_events.csv
  action_events.csv
  accumulation_events.csv
  accumulation_summary.csv
  tracked_events.csv
  timed_events.csv
  backup_info.json
```

백업은 무거운 작업 큐에서 단독 실행한다. 모니터링 중 실행 시 UI에 부하 가능성을 안내한다.

## 15. 데이터 보관 및 자동 삭제

기본 보관 기간은 최근 2개월이다.

삭제 기준:

```text
오늘 기준 2개월 전보다 오래된 logs/YYYY-MM-DD.json 삭제
```

실행 시점:

- 앱 실행 시 1회
- 앱 실행 중 하루 1회

모니터링 중에는 무거운 정리 작업을 피하고 다음 idle 시점으로 미룬다. 삭제 대상은 파일명 날짜 기준으로 판단하며, 모든 로그 파일 내용을 읽지 않는다.

설정 화면 안내 문구:

```text
룰렛 로그는 기본적으로 최근 2개월간 보관됩니다.
2개월이 지난 원본 로그는 앱 실행 시 자동으로 삭제됩니다.
필요한 기록은 삭제 전에 백업해 주세요.
```

## 16. 성능 원칙

목표:

```text
대기 상태 CPU: 1% 이하
모니터링 중 평균 CPU: 3% 이하
메모리 사용량: 500MB 이하
```

구현 원칙:

- 모니터링 WebView 또는 BrowserWindow는 1개만 유지한다.
- 전체 DOM polling을 금지한다.
- 로그 전체 폴더를 반복 로딩하지 않는다.
- 조회에 필요한 날짜 파일만 읽는다.
- 기간 누적형 합산은 선택 기간만 계산한다.
- 백업, 긴 기간 조회, 자동 삭제는 무거운 작업 큐에서 처리한다.
- 긴 작업은 날짜 파일 또는 200~500개 이벤트 단위로 chunk 처리하고 중간에 yield한다.
- 무거운 작업은 동시에 1개만 실행한다.

## 17. 구현 순서

### 17.1 기반 작업

1. Electron + React + TypeScript + Vite 프로젝트 생성
2. main/preload/renderer/shared 디렉터리 구성
3. 공통 타입과 상수 정의
4. IPC 통신 기본 구조 작성
5. 앱 데이터 폴더 초기화

### 17.2 로컬 저장 계층

1. `settings.json`, `mappings.json`, `filters.json` 초기화
2. 날짜별 로그 저장/조회 구현
3. 안전한 파일 쓰기 구현
4. 이벤트 상태 변경 구현
5. 기간 파일 단위 chunk 처리 유틸 구현

### 17.3 URL 저장과 설정

1. 위플랩 URL 입력 UI
2. URL 마스킹 처리
3. OS 보안 저장소 저장 시도
4. 로컬 설정 파일 fallback
5. UI/API/OBS에서 원문 URL 비노출 검증

### 17.4 UI 1차

1. 기본 레이아웃과 내비게이션
2. 대시보드
3. 전체 로그
4. 미분류
5. 상태 변경 UI

### 17.5 분류 기능

1. `mappings.json` 조회 로직
2. 미분류 항목 분류 저장
3. 기간 누적형 추가 입력
4. 시간 제한형 추가 입력
5. 기존 미분류 이벤트 재분류 기능

### 17.6 모니터링

1. 모니터링 시작/중지
2. 내부 BrowserWindow 로딩
3. 네트워크 이벤트 감지 검토
4. DOM MutationObserver fallback
5. 이벤트 정규화
6. 중복 방지
7. 저장 및 UI 알림

### 17.7 카테고리 화면

1. 즉시 처리형 화면
2. 후처리 추적형 화면
3. 기간 누적형 합산/로그 화면
4. 시간 제한형 진행/대기 화면
5. 타이머 시작/완료 처리

### 17.8 localhost API와 OBS 패널

1. `127.0.0.1` 바인딩 API 서버
2. 토큰 인증
3. 상태/이벤트 조회 API
4. 상태 변경 API
5. 타이머 시작/완료 API
6. OBS 패널 route
7. SSE 또는 WebSocket 상태 갱신

### 17.9 백업과 보관

1. 기간별 로그 병합
2. 카테고리별 CSV/JSON 생성
3. 누적형 합산 CSV 생성
4. ZIP 백업 생성
5. 백업 화면과 진행률
6. 2개월 초과 로그 자동 삭제

### 17.10 검증

1. 저장소 단위 테스트
2. 분류 로직 테스트
3. 중복 방지 테스트
4. 누적형 합산 테스트
5. 타이머 상태 전환 테스트
6. API 토큰 인증 테스트
7. 백업 결과 파일 검증
8. OBS 브라우저 독 표시 테스트
9. URL 원문 비노출 테스트
10. 긴 기간 조회와 백업 중 UI 응답성 확인

## 18. 주요 리스크와 대응

### 18.1 위플랩 감지 방식 불확실성

실제 위플랩 후원알림 URL의 DOM 구조와 네트워크 payload를 확인해야 안정적인 감지 로직을 만들 수 있다.

대응:

- `NetworkDetector`, `DomDetector`, `EventNormalizer`를 분리한다.
- 실제 구조 변경 시 정규화 계층만 수정할 수 있게 한다.
- DOM fallback은 알림 컨테이너의 `childList` 변화만 관찰한다.

### 18.2 OS 보안 저장소 호환성

`keytar`는 OS별 native dependency 이슈가 있을 수 있다.

대응:

- OS 보안 저장소를 우선 시도한다.
- 실패 시 로컬 설정 파일 fallback을 사용한다.
- fallback에서도 UI/API/OBS에 원문 URL을 노출하지 않는다.

### 18.3 파일 손상

방송 중 앱 종료나 쓰기 실패가 발생할 수 있다.

대응:

- 임시 파일 쓰기 후 rename한다.
- 기존 파일 `.bak` 생성을 고려한다.
- JSON parse 실패 시 `.bak` 복구 루틴을 둔다.

### 18.4 성능

Electron과 WebView를 무겁게 구현하면 방송 환경에 부담이 될 수 있다.

대응:

- WebView는 1개만 유지한다.
- 전체 DOM polling을 금지한다.
- 무거운 작업은 task queue에서 단독 실행한다.
- 파일은 날짜 단위로 읽고 chunk 처리한다.
- 목록 화면은 pagination 또는 가상 스크롤을 사용한다.

## 19. MVP 완료 기준

다음 항목이 동작하면 MVP 완료로 본다.

- 위플랩 URL을 로컬에 등록할 수 있다.
- URL 원문이 UI/API/OBS에 노출되지 않는다.
- 모니터링을 시작/중지할 수 있다.
- 새 룰렛 결과를 감지해 날짜별 JSON으로 저장한다.
- `nickname`, `value`, `roulette_content`, `received_at`, `id`가 저장된다.
- 3초 기준 중복 이벤트를 방지한다.
- 미분류 항목을 `action`, `accumulation`, `tracked`, `timed`, `excluded`로 분류할 수 있다.
- 동일 `roulette_content`는 이후 자동 분류된다.
- 전체 로그를 필터링해서 볼 수 있다.
- 즉시 처리형과 후처리 추적형 이벤트 상태를 변경할 수 있다.
- 기간 누적형을 주간/월간/사용자 지정 기간으로 합산할 수 있다.
- 시간 제한형 타이머를 시작/완료할 수 있고 남은 시간이 표시된다.
- localhost API가 `127.0.0.1`에서 토큰 인증으로 동작한다.
- OBS 브라우저 독 패널에서 주요 상태 확인과 처리 조작이 가능하다.
- 사용자가 기간을 선택해 ZIP 백업을 만들 수 있다.
- 2개월 초과 로그가 자동 삭제된다.
- 긴 기간 조회, 합산, 백업 중에도 UI와 모니터링이 멈추지 않는다.

## 20. 후순위

```text
OBS WebSocket 연동
방송 시작/종료 감지에 따른 자동 모니터링
방송 화면용 오버레이
CSV/엑셀 과거 데이터 가져오기
백업 복원
누적형 항목 자동 파싱 강화
시간 제한형 일시정지/재개
앱 자동 업데이트
```
