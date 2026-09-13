// src/reminder.js
// Evening Diary Reminder Engine (Web Notifications + Web Audio API Chime + In-App Banner)

import { getTodayString } from './storage.js';

export class ReminderManager {
  constructor(store, onTriggerEveningDiary) {
    this.store = store;
    this.onTriggerEveningDiary = onTriggerEveningDiary;
    this.audioCtx = null;
    this.timerId = null;
    this.lastTriggeredDate = null;
    this.init();
  }

  init() {
    this.checkReminder();
    // Check every 30 seconds
    this.timerId = setInterval(() => this.checkReminder(), 30000);
  }

  async requestPermission() {
    if (!('Notification' in window)) {
      return 'unsupported';
    }
    if (Notification.permission === 'granted') {
      return 'granted';
    }
    const result = await Notification.requestPermission();
    return result;
  }

  isPermissionGranted() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  // Synthesize a pleasant, warm evening temple-bell chime chord using Web Audio API
  playChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      // Frequencies for a soothing warm chime chord: C5 (523.25Hz), E5 (659.25Hz), G5 (783.99Hz), C6 (1046.5Hz)
      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        // Gentle strike envelope
        gain.gain.setValueAtTime(0.001, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.2, now + idx * 0.08 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 2.2);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 2.3);
      });
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  checkReminder() {
    const settings = this.store.getSettings();
    if (!settings.reminderEnabled) return;

    const today = getTodayString();
    // If today is already marked in diary, no need to nag
    if (this.store.isDateMarkedInDiary(today)) return;

    // Check time
    const now = new Date();
    const [targetH, targetM] = (settings.eveningReminderTime || '19:30').split(':').map(Number);
    const targetMinutes = targetH * 60 + targetM;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Trigger if current time is within 60 mins after target time and hasn't triggered today yet
    if (currentMinutes >= targetMinutes && currentMinutes <= targetMinutes + 120) {
      if (this.lastTriggeredDate !== today) {
        this.lastTriggeredDate = today;
        this.triggerReminder();
      }
    }
  }

  triggerReminder(isTest = false) {
    const settings = this.store.getSettings();
    const today = getTodayString();
    const txsToday = this.store.getTransactions(today);
    const haziriToday = this.store.getHaziri(today);
    const workerCount = Object.values(haziriToday).filter(h => h.status > 0).length;

    // 1. Audio chime
    if (settings.soundEnabled || isTest) {
      this.playChime();
    }

    // 2. System / Web Push Notification
    const title = isTest
      ? '🔔 टेस्ट रिमाइंडर: डायरी में लिखने का समय!'
      : '📖 शाम की डायरी: आज का हिसाब नोट कर लें!';

    const body = `आज कुल ${txsToday.length} लेनदेन दर्ज हैं और ${workerCount} कारीगर/हेल्पर काम पर थे। रात को डायरी में लिख लें।`;

    if (this.isPermissionGranted()) {
      try {
        const notif = new Notification(title, {
          body,
          icon: '/favicon.ico',
          tag: 'site-diary-evening-reminder',
          requireInteraction: true
        });
        notif.onclick = () => {
          window.focus();
          if (this.onTriggerEveningDiary) {
            this.onTriggerEveningDiary();
          }
          notif.close();
        };
      } catch (e) {
        console.warn('Notification trigger failed:', e);
      }
    }

    // 3. Notify app callback
    if (this.onTriggerEveningDiary && !isTest) {
      this.onTriggerEveningDiary();
    }
  }
}
