# Attendance Tracker

A responsive attendance dashboard and bunk calculator for college students.

## Firebase setup

Firebase's Spark plan is free for small projects and is enough for personal attendance tracking.

1. Create a project at [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication > Sign-in method > Email/Password**.
3. Create a **Firestore Database** in production mode.
4. In Project settings, create a Web app and copy its config values into `.env` using `.env.example`.
5. Add the contents of `firebase.rules` in Firestore Database > Rules and publish them.
6. Run `npm install` and `npm run dev`.

The Firestore rules limit every subject and history record to its authenticated owner. No service account key is used in the frontend.

Without Firebase environment variables, the app opens in local preview mode and stores data in the current browser. With Firebase configured, the same email/password account loads the same subjects on laptop and phone.

## Deploy to Vercel

Import this repository into Vercel. Vercel detects Vite automatically. Add the six `VITE_FIREBASE_*` values from `.env` under Vercel Project Settings > Environment Variables, then redeploy.

## Production build

```bash
npm run build
npm run preview
```
