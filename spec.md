# 活動即時互動系統 (Live Q&A / Poll) — 技術規格文件

> v2：部署於 GCP（Cloud Run + Firestore）

## 1. 專案概述

一個類似 Slido 的活動互動工具，主持人可建立題目（單選/多選/文字題），現場觀眾透過手機輸入答案，統計結果即時（1-3 秒內）顯示在大螢幕上。

**規模假設**：單場活動，約 500 名觀眾同時使用，僅有一個大螢幕顯示結果畫面。

**部署環境**：Google Cloud Platform — Cloud Run（後端 API）+ Cloud Firestore（資料儲存）。

**核心設計原則**：
- 觀眾送出答案 = 一次性 REST 請求，經過後端 API 驗證後寫入 Firestore，**不**讓前端直接寫入資料庫
- 題目與答案統計**全部存在 Firestore**，不用額外的 SQL 資料庫，也不用本地 JSON 檔案（Cloud Run 容器檔案系統是臨時的，重啟或多實例間不共享，不適合存放持久資料）
- 大螢幕端顯示結果：直接訂閱 Firestore 的即時監聽（`onSnapshot`），比自行刻 polling 更即時、程式碼更少
- Cloud Run 可以放心開啟自動擴展（多實例、scale to zero），因為所有狀態都在 Firestore，不依賴任何單一容器的記憶體或磁碟

---

## 2. 系統架構

```
┌─────────────┐   POST /api/sessions/:id/questions/:qid/answers
│ 觀眾手機網頁  │ ─────────────────────────────────────────────────┐
│ (React PWA) │                                                    │
└─────────────┘                                                    ▼
                                                          ┌──────────────────┐
┌─────────────┐   POST/PATCH /api/sessions/:id/questions  │  Cloud Run        │
│ 主持人後台    │ ─────────────────────────────────────────>│  Node.js+Express  │
│ (React)     │                                            │  (TypeScript)     │
└─────────────┘                                            │  - 驗證 hostToken │
                                                            │  - Rate limit     │
                                                            │  - 防重複作答      │──────┐
                                                            └──────────────────┘      │
                                                                                       ▼
┌─────────────┐                                                          ┌──────────────────────┐
│ 大螢幕投影    │  直接訂閱 Firestore onSnapshot（唯讀，繞過 Express API） │   Cloud Firestore     │
│ (React)     │ ───────────────────────────────────────────────────────> │ sessions/questions/   │
└─────────────┘         資料一變動，自動推送更新（< 1 秒）                │ answers（含計數）      │
                                                                          └──────────────────────┘
```

**為什麼大螢幕端不走 Express API？**
這部分本來就是唯讀，Firestore 原生的 `onSnapshot` 監聽機制可以讓前端直接訂閱文件變化，資料一改就自動推送，不需要自己刻 polling，也省掉一層後端轉發。風險點在於前端會直接帶有 Firestore 的讀取權限，因此**必須設定好 Security Rules**（見第 6 節），確保前端只能讀、不能寫。

**為什麼觀眾端答案不直接寫 Firestore，而要經過 Express API？**
寫入這端需要做：
- `hostToken` 之外的驗證（例如題目是否還處於 `OPEN` 狀態）
- Rate limit（防止單一裝置/IP 灌票)
- 防重複作答的商業邏輯
這些邏輯放在後端比放在 Firestore Security Rules 裡實作簡單、好維護，所以寫入統一收斂到 Express API。

---

## 3. 技術棚架

### 前端
- React 18 + TypeScript + Vite
- React Router（區分 `/host/:sessionId`、`/join/:sessionId`、`/display/:sessionId` 三種角色）
- 圖表：`recharts`（長條圖/圓餅圖呈現投票結果）
- Firebase JS SDK（`firebase/firestore`）：**只在 Display 頁面**用來做 `onSnapshot` 即時訂閱；Host / Join 頁面只透過 fetch 呼叫 Express API，不直接碰 Firestore

### 後端
- Node.js + Express + TypeScript
- Firebase Admin SDK（`firebase-admin`）：後端用 Admin SDK 讀寫 Firestore，不受 Security Rules 限制，由後端自行把關權限邏輯
- 驗證：`zod` 做 request body 驗證
- Rate limiting：`express-rate-limit`

### 資料儲存
- **Cloud Firestore**（Native mode）：題目、選項、答案計數、原始作答記錄全部存在這裡，不需要額外的 SQL 資料庫
- 不使用本地 JSON 檔案、不使用記憶體快取（Cloud Run 容器無持久檔案系統，多實例間不共享記憶體）

### 部署
- **Cloud Run**：後端 Express API 容器化部署，可正常開啟自動擴展（`min-instances` 不需要鎖 1，因為狀態不在容器內）
- **Cloud Build** 或 GitHub Actions：CI/CD 自動建置 Docker image、推送到 Artifact Registry、部署到 Cloud Run
- 前端：可用 **Firebase Hosting** 或直接放在同一個 Cloud Run 服務的靜態檔案路由（視團隊習慣）

---

## 4. 資料模型（Firestore 結構）

```
sessions (collection)
  └── {sessionId} (document)
        ├── name: string
        ├── hostToken: string          // 後端驗證主持人權限用，前端不可讀取此欄位
        ├── createdAt: timestamp
        │
        └── questions (subcollection)
              └── {questionId} (document)
                    ├── type: "SINGLE_CHOICE" | "MULTI_CHOICE" | "TEXT"
                    ├── title: string
                    ├── status: "DRAFT" | "OPEN" | "CLOSED"
                    ├── order: number
                    ├── options: [                       // 計數直接存在這裡，方便讀取
                    │     { id: "opt_react", label: "React", count: 0 },
                    │     { id: "opt_vue",   label: "Vue",   count: 0 }
                    │   ]
                    ├── totalResponses: number
                    │
                    └── answers (subcollection)
                          └── {respondentId} (document)   // 用 respondentId 當文件 ID
                                ├── optionId: string | null     // 選擇題填這個
                                ├── textValue: string | null    // 文字題填這個
                                └── createdAt: timestamp
```

**設計重點**：
- `options[].count` 用 Firestore 的 `FieldValue.increment(1)` 做**原子更新**，500 人同時送出答案不會有 race condition，GCP 在底層幫你處理併發寫入衝突。
- `answers` 子集合用 `respondentId`（觀眾端產生並存在瀏覽器 `localStorage` 的 UUID）當文件 ID，天然防止同一人重複建立答案記錄——重複送出時用 `set` 覆蓋既有文件即可，後端再自行決定是否允許「修改答案」（覆蓋舊計數、調整新計數）。
- 大螢幕端只需要訂閱 `questions/{questionId}` 這**一份文件**就能拿到完整的即時統計（`options[].count` + `totalResponses`），不需要監聽整個 `answers` 子集合，讀取量小、即時性好。

---

## 5. API 設計（Express，後端寫入用）

### 5.1 Session

| Method | Path | 說明 | 權限 |
|---|---|---|---|
| POST | `/api/sessions` | 建立新場次，回傳 `sessionId` + `hostToken` | 公開 |
| GET | `/api/sessions/:id` | 取得場次基本資訊（不含 `hostToken`） | 公開 |

### 5.2 Question

| Method | Path | 說明 | 權限 |
|---|---|---|---|
| POST | `/api/sessions/:id/questions` | 主持人建立新題目 | 需 `hostToken` |
| PATCH | `/api/sessions/:id/questions/:qid` | 修改題目狀態（開啟/關閉作答） | 需 `hostToken` |
| GET | `/api/sessions/:id/questions/current` | 取得目前 `OPEN` 狀態的題目（Join 頁面用） | 公開 |

**範例：建立題目**
```http
POST /api/sessions/abc123/questions
Authorization: Bearer <hostToken>
Content-Type: application/json

{
  "type": "SINGLE_CHOICE",
  "title": "你最喜歡的前端框架？",
  "options": ["React", "Vue", "Svelte"]
}
```

### 5.3 Answer

| Method | Path | 說明 | 權限 |
|---|---|---|---|
| POST | `/api/sessions/:id/questions/:qid/answers` | 觀眾送出答案，後端寫入 Firestore 並原子遞增計數 | 公開（含 rate limit） |

**範例：送出答案**
```http
POST /api/sessions/abc123/questions/q1/answers
Content-Type: application/json

{
  "respondentId": "uuid-stored-in-localstorage",
  "optionId": "opt_react"
}
```

**後端邏輯（概念）**
```ts
async function submitAnswer(sessionId: string, questionId: string, respondentId: string, optionId: string) {
  const answerRef = db
    .collection('sessions').doc(sessionId)
    .collection('questions').doc(questionId)
    .collection('answers').doc(respondentId);

  const questionRef = db
    .collection('sessions').doc(sessionId)
    .collection('questions').doc(questionId);

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(answerRef);
    if (existing.exists) {
      const prevOptionId = existing.data()?.optionId;
      if (prevOptionId === optionId) return; // 重複送出同一個答案，忽略
      // 修改答案：舊選項 -1，新選項 +1
      if (prevOptionId) {
        tx.update(questionRef, { [`optionCounts.${prevOptionId}`]: FieldValue.increment(-1) });
      }
    } else {
      tx.update(questionRef, { totalResponses: FieldValue.increment(1) });
    }
    tx.update(questionRef, { [`optionCounts.${optionId}`]: FieldValue.increment(1) });
    tx.set(answerRef, { optionId, createdAt: FieldValue.serverTimestamp() });
  });
}
```
> 用 Firestore Transaction 包起來，確保「檢查是否已作答」+「更新計數」是原子操作，避免併發時計數算錯。

### 5.4 Results（給 Host 後台查看用，非大螢幕）

| Method | Path | 說明 | 權限 |
|---|---|---|---|
| GET | `/api/sessions/:id/questions/:qid/results` | 取得統計結果（Host 後台想用 REST 拿資料時用，非必須） | 需 `hostToken` |

> 大螢幕端**不**呼叫這個 API，而是直接用 Firestore SDK 訂閱（見第 6 節）。這個 endpoint 主要是給 Host 後台或未來想做資料匯出功能時使用。

---

## 6. 大螢幕即時更新機制（Firestore onSnapshot）

大螢幕頁面直接用 Firebase JS SDK 訂閱題目文件，資料一變就自動推送，不需要 polling：

```tsx
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseClient';

function useLiveQuestion(sessionId: string, questionId: string) {
  const [question, setQuestion] = useState<QuestionData | null>(null);

  useEffect(() => {
    const ref = doc(db, 'sessions', sessionId, 'questions', questionId);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (snapshot.exists()) {
        setQuestion(snapshot.data() as QuestionData);
      }
    }, (error) => {
      console.error('Firestore subscription error', error);
      // 可在此加上重試/降級顯示上次結果的邏輯
    });
    return () => unsubscribe();
  }, [sessionId, questionId]);

  return question;
}
```

### Firestore Security Rules（草稿）

前端直接連 Firestore，**必須**限制權限，避免任何人打開瀏覽器 devtools 就能竄改票數：

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /sessions/{sessionId} {
      // session 文件本身（含 hostToken）完全禁止前端讀寫，只能由後端 Admin SDK 存取
      allow read, write: if false;

      match /questions/{questionId} {
        // 前端只能讀題目（大螢幕用），不能寫
        allow read: if true;
        allow write: if false;

        match /answers/{answerId} {
          // 答案完全不允許前端直接讀寫，必須經過 Express API
          allow read, write: if false;
        }
      }
    }
  }
}
```

> 重點：所有「寫入」一律 `false`，前端永遠只能讀 `questions` 文件本身（給大螢幕用），其餘全部擋掉，寫入動作統一收斂到後端 Admin SDK（不受這份規則限制）。

---

## 7. 前端頁面結構

```
src/
├── pages/
│   ├── HostPage.tsx       // 主持人後台：建題、控制題目開關（呼叫 Express API）
│   ├── JoinPage.tsx       // 觀眾端：看當前題目、送出答案（呼叫 Express API）
│   └── DisplayPage.tsx    // 大螢幕：訂閱 Firestore onSnapshot，即時呈現圖表
├── components/
│   ├── QuestionEditor.tsx
│   ├── ResultChart.tsx    // 用 recharts 畫長條圖/圓餅圖
│   └── AnswerForm.tsx
├── hooks/
│   └── useLiveQuestion.ts // 僅 DisplayPage 使用，內含 Firestore onSnapshot 邏輯
├── api/
│   └── client.ts          // 封裝對 Express API 的 fetch 呼叫（Host/Join 頁面用）
└── firebaseClient.ts      // 初始化 Firebase JS SDK（僅前端唯讀用途，使用受限的 API Key）
```

> 注意：`firebaseClient.ts` 裡的 Firebase 設定（apiKey 等）會暴露在前端程式碼中，這是正常且預期的行為——Firebase 的安全模型本來就是靠 Security Rules 把關，不是靠隱藏 API Key。

---

## 8. 非功能需求

| 項目 | 要求 |
|---|---|
| 並發量 | 500 人同時送出答案，尖峰可達數百 req/s 寫入 Cloud Run |
| 結果更新延遲 | < 1 秒（Firestore onSnapshot 即時推送，優於原先 polling 方案的 1-3 秒） |
| 防灌票 | `respondentId`（存於觀眾瀏覽器 localStorage）+ `express-rate-limit` 限制同 IP 請求頻率 |
| 計數正確性 | 用 Firestore Transaction 包住「檢查重複作答 + 更新計數」，避免並發寫入算錯票數 |
| Cloud Run 擴展設定 | 不需要鎖 `min-instances=1`，可正常自動擴展（多實例皆共用同一份 Firestore 資料，無一致性問題） |
| 行動裝置相容性 | 觀眾端需在手機瀏覽器（iOS Safari / Android Chrome）正常運作，RWD 排版 |
| Firestore 安全性 | 務必部署第 6 節的 Security Rules，否則前端可被竄改票數 |
| 容錯 | Display 頁面的 `onSnapshot` 監聽斷線時，Firebase SDK 會自動重連；可加上連線狀態提示 UI |

---

## 9. 未來可擴充方向（非本次必做）

- 若需要更複雜的權限管理（例如多個主持人協作同一場次），可改用 Firebase Authentication 取代簡單的 `hostToken` 機制。
- 活動結束後，可寫一個批次匯出腳本（Admin SDK 讀取 Firestore）把所有作答資料匯出成 CSV/Excel 供後續分析。
- 若未來需要觀眾端也即時看到統計結果（而非只有大螢幕），可以讓 Join 頁面也加上 `onSnapshot` 訂閱，重用 Display 頁面的邏輯。
- 若場次規模大幅成長（數千人以上），Firestore 本身已具備良好的水平擴展能力，不太需要額外架構調整；主要瓶頸會在 Cloud Run 的並發處理上限，可透過調整 Cloud Run 的 concurrency 設定與 max-instances 來應對。

---

## 10. 開發順序建議（MVP）

1. GCP 專案設定：啟用 Firestore（Native mode）、建立 Cloud Run 服務、設定 Firebase 專案
2. 後端：Session / Question 的 CRUD（Admin SDK 讀寫 Firestore）
3. 後端：Answer 送出邏輯（含 Transaction 原子計數更新）
4. 部署 Firestore Security Rules
5. 前端：Host 頁面（建題目 + 開關作答狀態）
6. 前端：Join 頁面（送出答案，含 `respondentId` 產生與儲存邏輯）
7. 前端：Display 頁面（Firestore `onSnapshot` 即時訂閱 + 圖表呈現）
8. 加上 rate limit、防重複作答的完整測試
9. 部署到 Cloud Run，模擬 500 人 load test（可用 `k6` 或 `artillery`）