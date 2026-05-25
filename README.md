# Local Roulette Manager

Weflab 룰렛 결과를 로컬에서 감지하고, 리액션/당첨/누적 항목을 OBS 브라우저 독에서 바로 처리하는 Windows용 무설치 앱입니다.

## 주요 기능

- Weflab 후원알림 URL 감시
- Weflab 시청자 룰렛 확률 공유 URL에서 룰렛 항목 자동 가져오기
- 룰렛 항목 자동 분류
  - 당첨 설정에 지정한 항목: 당첨
  - 숫자와 단위가 있는 항목: 누적
  - 그 외 항목: 리액션
- OBS 브라우저 독 지원
  - 전체/리액션/당첨/누적 탭
  - 시작일/종료일 기간 조회
  - 오늘 날짜 고정
  - 리액션 자동 삭제 카운트다운
  - 타이머 시작/실행 중/완료 처리
- OBS 송출 오버레이 타이머 표시
- 로그 저장, 일자별 자동 백업, 백업 확인
- 무설치 폴더 배포

## 다운로드

GitHub Releases에서 `Roulette-Manager-portable-folder-0.1.0-today-lock.zip`을 내려받아 압축을 풀고 실행합니다.

실행 파일:

```text
Roulette Manager.exe
```

## 빠른 시작

1. 압축을 풉니다.
2. `Roulette Manager.exe`를 실행합니다.
3. 설정에서 Weflab 후원알림 URL을 등록합니다.
4. 당첨 설정에서 Weflab 시청자 룰렛 확률 공유 URL을 등록하고 항목을 가져옵니다.
5. 당첨으로 처리할 항목을 선택해 `당첨룰렛 지정`을 누릅니다.
6. 대시보드에서 `모니터링 시작`을 누릅니다.
7. 설정 화면의 OBS 브라우저 독 URL과 오버레이 URL을 OBS에 추가합니다.

## 문서

- [사용설명서](docs/USER_GUIDE.md)
- [0.1.0 릴리스 노트](docs/RELEASE_NOTES_0.1.0.md)

## 데이터 저장

앱 설정, URL, 로그, 백업은 사용자 PC의 로컬 앱 데이터 영역에 저장됩니다. URL 원문은 앱 화면에 다시 표시하지 않습니다.

## 개발 명령

```bash
npm install
npm run dev
npm run build
npm run dist:dir
```

## 배포 형태

현재 0.1.0은 무설치 폴더 zip 배포를 기준으로 합니다. 압축을 푼 뒤 폴더 안의 `Roulette Manager.exe`를 더블클릭해서 실행합니다.
