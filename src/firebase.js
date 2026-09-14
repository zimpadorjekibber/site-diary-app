// src/firebase.js
// Firebase Cloud Firestore integration for Shram & Site Diary

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

let app = null;
let db = null;
let unsubscribeRealtime = null;

export function initFirebase(config) {
  if (!config || !config.apiKey || !config.projectId) {
    return false;
  }
  try {
    if (getApps().length > 0) {
      app = getApp();
    } else {
      app = initializeApp(config);
    }
    db = getFirestore(app);
    return true;
  } catch (err) {
    console.error('Firebase initialization error:', err);
    return false;
  }
}

export function isFirebaseReady() {
  return !!db;
}

export async function saveToFirebase(siteId = 'default_site', data) {
  if (!db) throw new Error('Firebase ????????? ???? ??');
  if (!siteId) siteId = 'default_site';

  const cleanSiteId = siteId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const siteDocRef = doc(db, 'site_diaries', cleanSiteId);

  const payload = {
    trades: data.trades || [],
    workers: data.workers || [],
    transactions: data.transactions || [],
    haziri: data.haziri || {},
    diaryNotedDates: data.diaryNotedDates || {},
    settings: {
      eveningReminderTime: data.settings?.eveningReminderTime || '19:30',
      currency: data.settings?.currency || '?',
      language: data.settings?.language || 'hi-IN'
    },
    updatedAt: new Date().toISOString(),
    timestamp: Date.now()
  };

  await setDoc(siteDocRef, payload, { merge: true });
  return true;
}

export async function loadFromFirebase(siteId = 'default_site') {
  if (!db) throw new Error('Firebase ????????? ???? ??');
  if (!siteId) siteId = 'default_site';

  const cleanSiteId = siteId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const siteDocRef = doc(db, 'site_diaries', cleanSiteId);
  const snap = await getDoc(siteDocRef);

  if (!snap.exists()) {
    throw new Error('?? ???? ???? ?? ??? ???? ???? ????');
  }

  return snap.data();
}

export function enableRealtimeSync(siteId = 'default_site', onDataUpdated) {
  if (!db) return null;
  if (unsubscribeRealtime) {
    unsubscribeRealtime();
    unsubscribeRealtime = null;
  }

  const cleanSiteId = siteId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const siteDocRef = doc(db, 'site_diaries', cleanSiteId);

  unsubscribeRealtime = onSnapshot(siteDocRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (onDataUpdated) onDataUpdated(data);
    }
  }, (err) => {
    console.error('Firebase realtime error:', err);
  });

  return unsubscribeRealtime;
}
