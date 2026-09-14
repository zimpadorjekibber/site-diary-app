// src/native-reminder.js
// Schedules the evening diary reminder through Android's own alarm manager, so it
// fires whether or not the app is open.
//
// The web build's reminder lives inside a setInterval, which only runs while the
// page is on screen — a contractor who closed the app after lunch was never
// reminded to write the diary, which is the one thing this app exists to do.
//
// Rather than one repeating daily alarm, this schedules the next HORIZON_DAYS
// individually and re-syncs whenever anything changes. That way a day the user
// has already written up can simply be skipped — impossible with a single
// repeating alarm.

const HORIZON_DAYS = 14;
const ID_BASE = 4200; // notification ids 4200..4213 belong to this feature

let pluginPromise = null;

function isNative() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

// Kept out of the web bundle: the import only runs inside the APK.
async function getPlugin() {
  if (!isNative()) return null;
  if (!pluginPromise) {
    pluginPromise = import('@capacitor/local-notifications')
      .then(m => m.LocalNotifications)
      .catch(err => {
        console.warn('LocalNotifications unavailable:', err);
        return null;
      });
  }
  return pluginPromise;
}

export function isNativeReminderSupported() {
  return isNative();
}

export async function requestNativePermission() {
  const LocalNotifications = await getPlugin();
  if (!LocalNotifications) return 'unsupported';
  try {
    const res = await LocalNotifications.requestPermissions();
    return res.display; // 'granted' | 'denied' | 'prompt'
  } catch (err) {
    console.warn('Notification permission request failed:', err);
    return 'denied';
  }
}

export async function getNativePermission() {
  const LocalNotifications = await getPlugin();
  if (!LocalNotifications) return 'unsupported';
  try {
    const res = await LocalNotifications.checkPermissions();
    return res.display;
  } catch {
    return 'denied';
  }
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Replaces every scheduled reminder with a fresh set.
 * @param {object} opts
 * @param {string} opts.time          "HH:MM"
 * @param {boolean} opts.enabled      false cancels everything
 * @param {(dateKey: string) => boolean} opts.isDateDone  skip days already written up
 * @param {string} opts.lang          'hi' | 'en'
 */
export async function syncNativeReminders({ time, enabled, isDateDone, lang = 'hi' }) {
  const LocalNotifications = await getPlugin();
  if (!LocalNotifications) return { scheduled: 0, supported: false };

  // Always clear first — the time may have moved, or a day may now be done.
  try {
    const pending = await LocalNotifications.getPending();
    const ours = (pending.notifications || []).filter(n => n.id >= ID_BASE && n.id < ID_BASE + HORIZON_DAYS);
    if (ours.length > 0) {
      await LocalNotifications.cancel({ notifications: ours.map(n => ({ id: n.id })) });
    }
  } catch (err) {
    console.warn('Could not clear pending reminders:', err);
  }

  if (!enabled) return { scheduled: 0, supported: true };

  const perm = await getNativePermission();
  if (perm !== 'granted') return { scheduled: 0, supported: true, permission: perm };

  const [hour, minute] = String(time || '19:30').split(':').map(Number);
  const now = new Date();
  const notifications = [];

  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour || 19, minute || 30, 0, 0);
    if (at <= now) continue;                       // today's slot has already passed
    if (isDateDone && isDateDone(dateKey(at))) continue; // diary already written

    notifications.push({
      id: ID_BASE + offset,
      title: lang === 'en' ? '📖 Evening Diary' : '📖 शाम की डायरी',
      body: lang === 'en'
        ? "Write down today's attendance and expenses in your diary."
        : 'आज की हाजिरी और खर्च अपनी डायरी में लिख लें।',
      schedule: { at, allowWhileIdle: true },
      smallIcon: 'ic_launcher',
      // Opening the notification should land on the diary tab.
      extra: { openTab: 'tab-diary' }
    });
  }

  if (notifications.length === 0) return { scheduled: 0, supported: true };

  try {
    await LocalNotifications.schedule({ notifications });
    return { scheduled: notifications.length, supported: true };
  } catch (err) {
    console.warn('Scheduling reminders failed:', err);
    return { scheduled: 0, supported: true, error: err.message };
  }
}

// Fires when the user taps the notification.
export async function onNativeReminderTapped(handler) {
  const LocalNotifications = await getPlugin();
  if (!LocalNotifications) return;
  try {
    await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      handler(event?.notification?.extra?.openTab || 'tab-diary');
    });
  } catch (err) {
    console.warn('Could not attach notification listener:', err);
  }
}
