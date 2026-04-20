# 24H Trading Agent

VSCode에서 바로 실행해 볼 수 있는 자동 트레이딩 에이전트 골격입니다.

중요: 이 프로젝트의 기본값은 `paper` 모드입니다. 실제 주문을 내지 않습니다. 실거래 연결은 반드시 소액, 제한 주문, 강한 리스크 제한, 충분한 백테스트와 모의 운용 후에만 추가하세요.

## 빠른 시작

```powershell
cd trading-agent
npm start -- --once
```

24시간 루프로 실행:

```powershell
npm start
```

현재 PC에서 `npm` 명령이 PATH에 안 잡히면 아래처럼 실행하세요.

```powershell
& 'C:\Program Files\nodejs\npm.cmd' start -- --once
```

## 구조

- `src/main.js`: 실행 진입점
- `src/agent.js`: 24시간 모니터링 루프
- `src/marketData.js`: 시세 공급자
- `src/strategy.js`: MA + RSI + MACD 조합 전략
- `src/risk.js`: 주문 전 리스크 검사
- `src/broker.js`: 페이퍼 브로커와 Alpaca 주문 어댑터
- `src/dashboard.js`: 웹 대시보드와 긴급정지 API
- `src/config.js`: 설정 로더
- `config.example.json`: 설정 예시
- `.vscode/launch.json`: VSCode 디버깅 설정

## 설정

처음에는 `config.example.json`을 그대로 읽습니다. 개인 설정을 쓰려면 복사해서 `config.json`을 만드세요.

```powershell
Copy-Item config.example.json config.json
```

## 다음 단계

## 지금 반영된 기능

1. 실제 API 어댑터 골격
   - `market_data.provider`를 `alpaca`로 바꾸면 Alpaca 시세 API를 사용합니다.
   - `broker.provider`를 `alpaca`로 바꾸면 Alpaca 주문 어댑터를 사용합니다.
   - 실주문은 `live_trading_enabled=true`와 환경변수 `ENABLE_LIVE_TRADING=true`가 둘 다 있어야만 열립니다.

2. 전략
   - 단순 이동평균 교차에서 `MA + RSI + MACD` 조합 전략으로 확장했습니다.
   - 설정값은 `strategy` 블록에서 바꿀 수 있습니다.

3. 대시보드
   - 24시간 모드로 실행하면 `http://localhost:8787` 대시보드가 열립니다.
   - 현금, 평가금, 실현손익, 시세, 포지션, 최근 체결, 거절된 주문을 확인할 수 있습니다.

4. 안전장치
   - 주문당 최대 금액: `risk.max_order_value`
   - 종목별 최대 포지션 금액: `risk.max_position_value`
   - 일일 최대 손실: `risk.max_daily_loss`
   - 공매도 차단: `risk.allow_short_selling=false`
   - 긴급정지 파일: `data/emergency-stop.json`
   - 대시보드의 `Emergency Stop` 버튼을 누르면 다음 루프부터 주문과 시세 처리를 멈춥니다.

## Alpaca 연결 환경변수

PowerShell 예시:

```powershell
$env:ALPACA_API_KEY_ID='your-key'
$env:ALPACA_API_SECRET_KEY='your-secret'
$env:ALPACA_TRADING_BASE_URL='https://paper-api.alpaca.markets'
$env:ALPACA_DATA_BASE_URL='https://data.alpaca.markets'
```

실거래 잠금 해제는 의도적으로 번거롭게 해두었습니다.

```powershell
$env:ENABLE_LIVE_TRADING='true'
```

그 전에 반드시 `paper` 모드로 충분히 오래 돌려보세요.
