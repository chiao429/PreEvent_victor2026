# PreEvent_victor2026 Cloud Run 部署步驟

## 專案資訊

- **GCP 專案 ID**：preevent-victor-2026
- **Firebase 專案 ID**：preevent-victor-2026（同一個）
- **程式碼位置（Cloud Shell）**：~/PreEvent_victor2026
- **GitHub**：git@github.com:chiao429/PreEvent_victor2026.git

## 部署的網址

- **前端**：https://preevent-frontend-46365571298.asia-east1.run.app
- **後端**：https://preevent-backend-46365571298.asia-east1.run.app

---

## 前置作業（只需做一次）

### 1. 切換到專案
```bash
gcloud config set project preevent-victor-2026
```

### 2. 啟用 API
```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com
```

### 3. 建立 Firestore 資料庫
```bash
gcloud firestore databases create --location=asia-east1 --project preevent-victor-2026
```

---

## 部署後端（Express + Firestore）

```bash
cd ~/PreEvent_victor2026/backend
gcloud run deploy preevent-backend \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --set-env-vars FIREBASE_PROJECT_ID=preevent-victor-2026
```

> **注意：**
> - Cloud Run 自動使用 Application Default Credentials（ADC），不需要上傳 service account JSON
> - 後端程式碼用 `admin.credential.applicationDefault()` 初始化 Firebase Admin
> - 後端 CORS 設定為 `origin: '*'`，允許所有來源

---

## 部署前端（Vite + React）

### 前端 Dockerfile
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
```

### 前端 nginx.conf
本地開發靠 Vite proxy 把 `/api` 轉到後端，部署後需要 nginx 做同樣的事：

```nginx
server {
    listen 8080;

    location /api/ {
        proxy_pass https://preevent-backend-46365571298.asia-east1.run.app;
        proxy_set_header Host preevent-backend-46365571298.asia-east1.run.app;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_ssl_server_name on;
    }

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri.html $uri/ /index.html;
    }
}
```

### 前端 .env.production
```dotenv
VITE_API_URL=https://preevent-backend-46365571298.asia-east1.run.app
VITE_FIREBASE_API_KEY=你的值
VITE_FIREBASE_AUTH_DOMAIN=preevent-victor-2026.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=preevent-victor-2026
VITE_FIREBASE_STORAGE_BUCKET=preevent-victor-2026.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=你的值
VITE_FIREBASE_APP_ID=你的值
```

> **重要：** `VITE_API_URL` 必須填後端 Cloud Run 網址，本地 `.env` 是空的（靠 Vite proxy），但 `.env.production` 一定要填。

### 部署指令
```bash
cd ~/PreEvent_victor2026/frontend
gcloud run deploy preevent-frontend \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated
```

---

## 自動部署（已設定完成）

已透過 Cloud Build 觸發條件連結 GitHub，push 到 `main` 分支時會自動部署。

### 觸發條件

- **deploy-backend**：偵測 `backend/**` 有變動時觸發，讀取 `backend/cloudbuild.yaml`
- **deploy-frontend**：偵測 `frontend/**` 有變動時觸發，讀取 `frontend/cloudbuild.yaml`
- **服務帳戶**：`46365571298-compute@developer.gserviceaccount.com`

### backend/cloudbuild.yaml
```yaml
steps:
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    dir: 'backend'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'preevent-backend'
      - '--source'
      - '.'
      - '--region'
      - 'asia-east1'
      - '--allow-unauthenticated'
      - '--set-env-vars'
      - 'FIREBASE_PROJECT_ID=preevent-victor-2026'
options:
  logging: CLOUD_LOGGING_ONLY
timeout: '600s'
```

### frontend/cloudbuild.yaml
```yaml
steps:
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    dir: 'frontend'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'preevent-frontend'
      - '--source'
      - '.'
      - '--region'
      - 'asia-east1'
      - '--allow-unauthenticated'
options:
  logging: CLOUD_LOGGING_ONLY
timeout: '600s'
```

### 設定步驟（已完成，僅供參考）

1. Cloud Build → 觸發條件 → 連結存放區 → 選 GitHub → 授權 → 選 `chiao429/PreEvent_victor2026`
2. 建立觸發條件 `deploy-backend`：分支 `^main$`、包含檔案 `backend/**`、設定檔 `backend/cloudbuild.yaml`
3. 建立觸發條件 `deploy-frontend`：分支 `^main$`、包含檔案 `frontend/**`、設定檔 `frontend/cloudbuild.yaml`
4. Cloud Shell 設定 SSH key 以便 push：`ssh-keygen` → 把公鑰加到 GitHub Settings → SSH keys

### 建構記錄

查看建構狀態：https://console.cloud.google.com/cloud-build/builds?project=preevent-victor-2026

---

## 日後更新程式碼流程

自動部署已設好，只需要：

```bash
git add .
git commit -m "描述修改內容"
git push
```

Cloud Build 會自動偵測改了前端還是後端，分別觸發部署。

### 手動部署（備用）

如果需要手動部署，可在 Cloud Shell 上跑：

```bash
# 後端
cd ~/PreEvent_victor2026/backend
gcloud run deploy preevent-backend \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --set-env-vars FIREBASE_PROJECT_ID=preevent-victor-2026

# 前端
cd ~/PreEvent_victor2026/frontend
gcloud run deploy preevent-frontend \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated
```

---

## 本地開發設定

### backend/.env
```dotenv
PORT=8080
FIREBASE_PROJECT_ID=preevent-victor-2026
GOOGLE_APPLICATION_CREDENTIALS=./你的金鑰檔名.json
```

### frontend/.env
```dotenv
VITE_API_URL=
VITE_FIREBASE_API_KEY=你的值
VITE_FIREBASE_AUTH_DOMAIN=preevent-victor-2026.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=preevent-victor-2026
VITE_FIREBASE_STORAGE_BUCKET=preevent-victor-2026.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=你的值
VITE_FIREBASE_APP_ID=你的值
```

> 本地 `VITE_API_URL` 留空，Vite proxy（vite.config.ts）會自動把 `/api` 轉到 `localhost:8080`

---

## 注意事項

- Cloud Run 預設使用 port `8080`，後端的 `process.env.PORT ?? 8080` 會自動取得
- 第一次部署約需 3-5 分鐘，之後更新會快一些
- Cloud Run 冷啟動會慢幾秒，如需加速可設 `--min-instances 1`（會持續計費）
- `VITE_` 開頭的環境變數是 build 時寫入的，修改後必須重新部署前端
- Cloud Run 不需要 service account JSON，ADC 會自動處理認證
- 本地開發需要 service account JSON，從 GCP Console → IAM → 服務帳戶 → 管理金鑰下載
- WebSocket 功能（ThreeMapScene、SpotlightScene）後端尚未實作，目前即時同步靠 Firestore onSnapshot