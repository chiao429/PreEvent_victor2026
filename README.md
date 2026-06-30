# PreEvent — 活動即時互動系統

類 Slido 的活動互動工具。主持人建立單選/多選/文字題，觀眾手機掃碼作答，結果即時（< 1 秒）呈現在大螢幕。

## 技術棚架

| 層級 | 技術 |
|------|------|
| 後端 | Node.js + Express + TypeScript |
| 資料庫 | Cloud Firestore（Native mode） |
| 前端 | React 18 + Vite + TypeScript |
| 即時更新 | Firestore `onSnapshot`（大螢幕） |
| 樣式 | Tailwind CSS |
| 圖表 | Recharts |
| 部署 | Cloud Run（後端）+ Firebase Hosting 或 Cloud Run（前端） |

## 專案結構

```
├── backend/                  # Express API（Cloud Run 容器）
│   ├── src/
│   │   ├── index.ts          # Express 入口
│   │   ├── types.ts          # 共用型別
│   │   ├── lib/
│   │   │   └── firebaseAdmin.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts       # hostToken 驗證
│   │   │   └── rateLimiter.ts
│   │   └── routes/
│   │       ├── sessions.ts
│   │       ├── questions.ts
│   │       └── answers.ts    # Firestore Transaction 原子計數
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                 # React PWA
│   ├── src/
│   │   ├── pages/
│   │   │   ├── HomePage.tsx      # 建立/加入場次
│   │   │   ├── HostPage.tsx      # 主持人後台
│   │   │   ├── JoinPage.tsx      # 觀眾作答（手機）
│   │   │   └── DisplayPage.tsx   # 大螢幕（Firestore onSnapshot）
│   │   ├── components/
│   │   │   ├── QuestionEditor.tsx
│   │   │   ├── AnswerForm.tsx
│   │   │   └── ResultChart.tsx
│   │   ├── hooks/
│   │   │   └── useLiveQuestion.ts
│   │   ├── api/client.ts
│   │   └── firebaseClient.ts     # Firebase JS SDK（唯讀）
│   └── package.json
│
├── firestore.rules           # Firestore Security Rules
└── .github/workflows/
    └── deploy.yml            # CI/CD → Cloud Run
```

## 路由說明

| 路徑 | 角色 | 說明 |
|------|------|------|
| `/` | 任何人 | 建立場次或輸入 ID 加入 |
| `/host/:sessionId` | 主持人 | 建題、開關作答、查看結果 |
| `/join/:sessionId` | 觀眾 | 作答頁（手機掃碼） |
| `/display/:sessionId` | 大螢幕 | 即時圖表顯示（Firestore onSnapshot） |

## 本地開發

### 1. 安裝依賴

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. 設定環境變數

```bash
# backend
cp backend/.env.example backend/.env
# 填入 FIREBASE_PROJECT_ID 與 GOOGLE_APPLICATION_CREDENTIALS

# frontend
cp frontend/.env.example frontend/.env
# 填入 VITE_FIREBASE_* 設定（從 Firebase Console 複製）
```

### 3. 啟動服務

```bash
# Terminal 1：後端
cd backend && npm run dev

# Terminal 2：前端
cd frontend && npm run dev
```

前端 http://localhost:5173，API 呼叫透過 Vite proxy 轉發到 http://localhost:8080。

### 4. 部署 Firestore Security Rules

```bash
firebase deploy --only firestore:rules
```

## API 總覽

```
POST   /api/sessions                              建立場次
GET    /api/sessions/:id                          取得場次資訊

GET    /api/sessions/:id/questions                取得所有題目（需 hostToken）
POST   /api/sessions/:id/questions                建立題目（需 hostToken）
PATCH  /api/sessions/:id/questions/:qid           更新題目狀態（需 hostToken）
GET    /api/sessions/:id/questions/current        取得目前 OPEN 題目（公開）
GET    /api/sessions/:id/questions/:qid/results   取得統計結果（需 hostToken）

POST   /api/sessions/:id/questions/:qid/answers   送出答案（rate limited）
```

## GCP 部署需求

- Firestore Native mode 已啟用
- Artifact Registry 已建立（`preevent` repository）
- Cloud Run 服務已建立（`preevent-api`）
- GitHub Secrets 已設定：
  - `GCP_PROJECT_ID`
  - `GCP_WORKLOAD_IDENTITY_PROVIDER`
  - `GCP_SERVICE_ACCOUNT`