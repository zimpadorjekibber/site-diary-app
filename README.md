# श्रम व साइट डायरी · Shram & Site Diary

निर्माण साइट के ठेकेदार के लिए रोज़ का हिसाब — हाज़िरी, पेशगी, राशन और शाम की डायरी।
एक फ़ोन में, हिंदी में, बिना इंटरनेट के भी।

A daily ledger for Indian construction-site contractors: attendance, cash
advances, shared kitchen costs, and the evening diary slip they copy into their
physical register. Offline-first, Hindi-first.

**Live:** https://zimpadorjekibber.github.io/site-diary-app/
**Android:** [latest release](https://github.com/zimpadorjekibber/site-diary-app/releases/latest)

---

## यह ऐप क्या करता है

| स्क्रीन | काम |
|---|---|
| **दैनिक हाज़िरी** | किसी भी ट्रेड के सारे कारीगरों की हाज़िरी एक नज़र में — पूरा दिन, आधा दिन, ओवरटाइम |
| **लेन-देन** | नकद पेशगी, रिचार्ज, राशन, सिलेंडर, डीज़ल, सामान — बोलकर या लिखकर |
| **मस्टर रोल** | पूरे महीने का रजिस्टर, CSV/प्रिंट के साथ |
| **कारीगर खाता** | हर कारीगर का कमाया, दिया और बकाया; WhatsApp पर भेजने लायक पर्ची |
| **शाम डायरी** | दिन भर का हिसाब एक स्लिप में, कॉपी करके असली डायरी में उतारने के लिए |

शाम को तय समय पर रिमाइंडर बजता है — APK में ऐप बंद होने पर भी।

---

## चलाने के लिए

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | काम |
|---|---|
| `npm run dev` | लोकल डेवलपमेंट |
| `npm run build` | वेब build (`dist/`) |
| `npm run sync` | build + Capacitor sync |
| `npm run apk` | debug APK |
| `npm run apk:release` | signed APK (`android/keystore.properties` चाहिए) |
| `npm run rules:deploy` | Firestore security rules |

---

## बनावट

बिना किसी framework के — सादा ES modules, Vite से bundle, Capacitor से Android।
इसकी वजह साफ़ है: ऐप गाँव-देहात के धीमे नेटवर्क पर खुलना चाहिए, इसलिए bundle
जितना छोटा हो उतना अच्छा (अभी 43 kB gzip; Firebase अलग से तभी आता है जब sync चले)।

```
src/
  main.js            App controller — हर स्क्रीन का render और सारे event handlers
  storage.js         localStorage डेटा परत; हिसाब की सारी गणना यहीं
  firebase.js        Firestore sync (payload बनाना, भेजना, लाना)
  firebase-lazy.js   Firebase SDK तभी लोड हो जब ज़रूरत पड़े
  speech.js          आवाज़ से entry — Web Speech API + हिंदी/हिंग्लिश parser
  reminder.js        शाम का रिमाइंडर (ब्राउज़र)
  native-reminder.js शाम का रिमाइंडर (Android alarm, ऐप बंद हो तब भी)
  i18n.js            हिंदी / English
  style.css          Light "field-first" design system
```

### डेटा कहाँ रहता है

पहले **फ़ोन में** (`localStorage`) — इंटरनेट न हो तब भी पूरा ऐप चलता है।
फिर, अगर cloud backup चालू है, तो Firestore में `site_diaries/<site-id>`।

हर install अपनी एक **अलग, अनुमान-रहित site ID** बनाता है (`site-XXXX-XXXX`)।
ऐप में login नहीं है, इसलिए वही ID उस साइट के हिसाब की पूरी सुरक्षा है —
[`firestore.rules`](firestore.rules) उसी के इर्द-गिर्द बनी हैं।

### हिसाब के दो नियम

सारी स्क्रीनें यही दो नियम मानती हैं, वरना एक ही कारीगर का बकाया दो जगह दो अलग
दिखने लगता है:

1. **कारीगर को दिया** = उस कारीगर के नाम पर दर्ज हर खर्च (सिर्फ़ नकद नहीं — रिचार्ज,
   सामान, कुछ भी)
2. **साइट का खर्च** = ग्रुप के नाम पर दर्ज सब कुछ (राशन, सिलेंडर, डीज़ल…)

नया लेन-देन प्रकार जोड़ना हो तो [`storage.js`](src/storage.js) के `TX_TYPES` में
जोड़िए — हर स्क्रीन वहीं से पढ़ती है, इसलिए वो अपने आप हर जगह गिना जाने लगेगा।

---

## Setup और deploy

### उधार का पासवर्ड

सेटिंग्स → उधार रजिस्टर में पहली बार अपना कम से कम 6 अक्षर/अंक का पासवर्ड बनाएँ।
सेक्शन छोड़ने, सेटिंग्स खोलने, ऐप बैकग्राउंड में जाने या 2 मिनट निष्क्रिय रहने पर
उधार फिर लॉक हो जाता है। पासवर्ड बदलने के लिए पुराना पासवर्ड ज़रूरी है। पाँच गलत
प्रयासों के बाद एक मिनट का इंतज़ार लगता है। बैकअप डाउनलोड भी पासवर्ड से सुरक्षित है।

यह इस डिवाइस की स्क्रीन का गोपनीयता लॉक है; स्थानीय डेटा, क्लाउड और डाउनलोड किए
गए बैकअप का एन्क्रिप्शन नहीं है। पासवर्ड का salted hash इसी डिवाइस पर रहता है,
बैकअप में नहीं जाता। दूसरे फ़ोन पर अलग से पासवर्ड सेट करें। पासवर्ड भूलने पर
ऐप में रीसेट नहीं है। ऐप का स्टोरेज साफ़ करने पर डिवाइस का लॉक भी हट जाता है।

लॉक के परीक्षण: `node --test tests/lending-lock.test.js`

पहली बार सेट करने की चीज़ें — Firestore rules, release signing, रिमाइंडर —
सब [DEPLOY.md](DEPLOY.md) में हैं।

हर push पर वेब ऐप GitHub Pages पर और APK एक नई release पर अपने आप चढ़ जाता है।
