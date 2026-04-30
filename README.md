# 🏏 RPL Auction 2026

A real-time, password-protected cricket auction portal for 6 teams. Admin controls the auction flow, and team captains bid live from their own devices.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![Firebase](https://img.shields.io/badge/Firebase-Realtime_DB-FFCA28?logo=firebase)
![GitHub Pages](https://img.shields.io/badge/Hosted-GitHub_Pages-222?logo=github)

## Features

- 🔒 **Password-protected** login for Admin + 6 Captain portals
- 🔴 **Real-time bidding** — all captains see bids instantly
- ⏱️ **15-second countdown timer** after each bid
- 👑 **Admin panel** — start auctions, sell/unsold, bid on behalf
- 🏏 **Captain panel** — one-tap bidding, squad view, C/VC assignment
- 🔑 **Admin can change** all passwords at runtime
- 🔒 **3-attempt lockout** (30s cooldown) for security
- 📱 **Mobile-friendly** — captains can bid from their phones

## Quick Setup (15 minutes)

### Step 1: Create Firebase Project (Free)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **"Create a project"** → name it `rpl-auction`
3. Go to **Build → Realtime Database → Create Database**
   - Select your region (e.g., `asia-south1` for India)
   - Start in **Test Mode**
4. Go to **Project Settings** (⚙️) → **General** → scroll down
5. Click **"Add app"** → choose **Web** (</>) → register
6. **Copy the `firebaseConfig` object**

### Step 2: Add Firebase Config

Open `src/firebase.js` and replace the placeholder config:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",                // YOUR key
  authDomain: "rpl-auction.firebaseapp.com",
  databaseURL: "https://rpl-auction-default-rtdb.asia-south1.firebasedatabase.app",
  projectId: "rpl-auction",
  storageBucket: "rpl-auction.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### Step 3: Push to GitHub

```bash
git init
git add .
git commit -m "RPL Auction 2026"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/rpl-auction.git
git push -u origin main
```

### Step 4: Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Source: **GitHub Actions**
3. The included workflow auto-deploys on every push to `main`
4. Your app will be live at: `https://YOUR_USERNAME.github.io/rpl-auction/`

## Default Passwords

| Portal | Password |
|--------|----------|
| 👑 Admin | `rpl@admin2026` |
| 🔴 Thunder Strikers | `thunder@01` |
| 🔵 Royal Warriors | `royal@02` |
| 🟢 Green Titans | `green@03` |
| 🟡 Golden Eagles | `golden@04` |
| 🟣 Purple Storm | `purple@05` |
| 🟠 Orange Blazers | `orange@06` |

> Admin can change all passwords from the 🔑 Passwords panel after login.

## How to Run the Auction

1. **Admin** opens the app and logs in
2. Share the URL with 6 **team captains** (they log in with their passwords)
3. Admin clicks **🎬 START AUCTION** → a random player appears
4. Captains see the player and tap **BID** on their screens
5. **15-second timer** starts after each bid — others can outbid
6. Admin can **SELL NOW** or wait for timer to auto-sell
7. Repeat for all 74 players!

## Local Development

```bash
npm install
npm start
```

Opens at `http://localhost:3000`

## Tech Stack

- **React 18** — UI framework
- **Firebase Realtime Database** — real-time sync (free tier: 100 simultaneous connections)
- **GitHub Pages** — free hosting
- **GitHub Actions** — auto-deploy on push
