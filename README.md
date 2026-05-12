# 🌸 빛꽃수행일지 — Vercel 배포 가이드

증산도 대학생 연합회 수행일지 앱

---

## 📦 파일 구조

```
bitkkot-suhaeng/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    └── App.jsx
```

---

## 🚀 배포 순서 (처음 하시는 분)

### STEP 1 — GitHub 계정 만들기
1. [github.com](https://github.com) 접속
2. **Sign up** 클릭 → 이메일/비밀번호 입력 → 가입 완료

---

### STEP 2 — 새 Repository 만들기
1. GitHub 로그인 후 우측 상단 **+** 버튼 → **New repository**
2. Repository name: `bitkkot-suhaeng`
3. **Public** 선택 (Vercel 무료 배포에 필요)
4. **Create repository** 클릭

---

### STEP 3 — 파일 업로드
1. 생성된 repository 페이지에서 **uploading an existing file** 클릭
2. 이 폴더 안의 **모든 파일과 폴더**를 드래그해서 올리기
   - `index.html`
   - `package.json`
   - `vite.config.js`
   - `src/` 폴더 전체 (main.jsx, App.jsx)
3. **Commit changes** 클릭

---

### STEP 4 — Vercel 계정 만들기 & 배포
1. [vercel.com](https://vercel.com) 접속
2. **Sign Up → Continue with GitHub** 클릭
3. GitHub 계정으로 로그인 허용
4. **Add New → Project** 클릭
5. `bitkkot-suhaeng` repository 선택 → **Import**
6. 설정은 그대로 두고 **Deploy** 클릭
7. 2~3분 후 배포 완료! 🎉

---

### STEP 5 — URL 공유
배포 완료 후 다음과 같은 주소가 생성돼요:
```
https://bitkkot-suhaeng.vercel.app
```
이 링크를 카톡/문자로 공유하면 누구나 접속 가능해요!

---

## 📱 스마트폰 홈화면에 추가하는 법

### iOS (아이폰)
1. Safari에서 배포된 URL 접속
2. 하단 공유 버튼(□↑) 탭
3. **홈 화면에 추가** 선택

### Android
1. Chrome에서 배포된 URL 접속
2. 우측 상단 메뉴(⋮) 탭
3. **홈 화면에 추가** 선택

---

## ⚠️ 현재 버전 주의사항

- **데이터는 각자 기기에 저장**돼요 (localStorage)
- 기기를 바꾸면 기존 데이터는 이어지지 않아요
- 여러 사람 데이터를 함께 관리하려면 Firebase 연동이 필요해요

---

## 🔧 수정 방법

1. `src/App.jsx` 파일을 수정
2. GitHub에 다시 업로드
3. Vercel이 자동으로 재배포

---

개발·운영: 증산도 대학생 연합회
