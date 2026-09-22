# Deploy और Setup — श्रम व साइट डायरी

तीन चीज़ें एक-एक बार सेट करनी हैं। उसके बाद सब अपने आप चलता रहेगा।

---

## 1. Firestore security rules (सबसे ज़रूरी)

ऐप में अब Google login है, और हर हिसाब किसी एक खाते का होता है — document पर
`ownerUid` बताता है किसका। **site ID अब सिर्फ़ एक नाम है, password नहीं:** उसे
जान लेने भर से हिसाब नहीं खुलता, खाता चाहिए।

(21 सितम्बर 2026 तक ऐसा नहीं था। तब site ID ही पूरी सुरक्षा थी, और वही एक
reinstall में पूरा महीना ले गया — देखिए `mcp/README.md` और `PLAYSTORE.md`।)

Rules फ़ाइल: [`firestore.rules`](firestore.rules)

```bash
firebase login
```

> ध्यान दें: इस मशीन पर अभी `tashizomkibber@gmail.com` से login है, और उस account
> को `khalen-dairy` project नहीं दिखता (deploy करने पर `403 permission denied`
> आया)। जिस account का यह project है, उसी से login करें —
> `firebase login:use <email>` से account बदल सकते हैं।

फिर:

```bash
npm run rules:deploy
```

Rules क्या करती हैं:

| नियम | क्यों |
|---|---|
| सिर्फ़ `site-XXXX-XXXX` जैसी ID पढ़ी/लिखी जा सकती है | छोटे या अंदाज़े वाले नाम स्कैन करने पर कुछ नहीं मिलेगा |
| collection की list कभी नहीं | कोई साइटें गिन नहीं सकता, सिर्फ़ पूरी ID अंदाज़ सकता है (32⁸ combinations) |
| सिर्फ़ इस ऐप जैसा payload लिखा जा सकता है | कोई कचरा document असली हिसाब की जगह नहीं ले सकता |
| delete कभी नहीं | ऐप कभी साइट document मिटाता ही नहीं |

Rules बदलने के बाद **MCP endpoint की भी जाँच करें**: वह बिना login पढ़ता था, और
अब उसे service account चाहिए (`SITE_DIARY_SERVICE_ACCOUNT`) — देखिए
`mcp/README.md`। बिना उसके वह हर owned हिसाब पर "permission denied" देगा।

---

## 2. Signed release APK

अभी तक APK **debug key** से signed जाता था — यानी वही key जो दुनिया के हर
Android SDK में है। उससे Play Store पर नहीं चढ़ सकते, और कोई भी APK बदलकर
दोबारा sign कर सकता है।

### एक बार: अपनी release key बनाएँ

यह command **आप चलाएँ** — key का password सिर्फ़ आपके पास रहना चाहिए। यह key
खो गई तो उसी app ID पर कभी update नहीं भेज पाएंगे, इसलिए इसका backup ज़रूर रखें
(password manager या Google Drive में)।

```bash
keytool -genkeypair -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sitediary
```

### GitHub Actions के लिए

Keystore को base64 में बदलें:

```bash
base64 -w0 release.jks > release.jks.b64
```

फिर GitHub पर **Settings → Secrets and variables → Actions** में चार secrets
जोड़ें:

| Secret | Value |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | `release.jks.b64` फ़ाइल का पूरा text |
| `RELEASE_STORE_PASSWORD` | keystore का password |
| `RELEASE_KEY_ALIAS` | `sitediary` |
| `RELEASE_KEY_PASSWORD` | key का password (अक्सर वही) |

बस। अगले push से [`build-apk.yml`](.github/workflows/build-apk.yml) खुद signed
release APK बनाएगा। Secret सेट होने तक वह debug APK बनाता रहेगा, ताकि pipeline
टूटे नहीं।

### लोकल signed build के लिए

`android/keystore.properties` बनाएँ (यह gitignored है):

```properties
storeFile=../release.jks
storePassword=आपका-password
keyAlias=sitediary
keyPassword=आपका-password
```

फिर:

```bash
npm run apk:release
```

> **कभी भी** `release.jks`, `.b64` फ़ाइल या `keystore.properties` को git में
> commit न करें — `.gitignore` में तीनों जोड़ दिए गए हैं।

---

## 3. शाम का रिमाइंडर (APK में)

यह काम **हो चुका है** — कुछ करने की ज़रूरत नहीं, बस जानकारी के लिए:

- `@capacitor/local-notifications` से अब Android खुद अलार्म रखता है, इसलिए ऐप
  बंद होने पर भी रिमाइंडर बजेगा। फ़ोन restart होने पर भी अलार्म वापस लग जाते हैं।
- अगले **14 दिन** के अलार्म एक साथ लगते हैं और हर बार ऐप खुलने पर ताज़ा होते हैं।
  जिस दिन की डायरी लिख ली, उस दिन का अलार्म अपने आप हट जाता है।
- रिमाइंडर का समय बदलने या बंद करने पर अलार्म तुरंत दोबारा लगते हैं।
- Android 12+ पर exact alarm की अनुमति न मिले तो plugin अपने आप inexact alarm पर
  चला जाता है (कुछ मिनट देर से बजेगा, पर बजेगा) — कोई extra permission माँगनी
  नहीं पड़ती।
- ब्राउज़र में यह संभव नहीं है; वहाँ Settings में साफ़ लिखा दिखता है कि रिमाइंडर
  तभी बजेगा जब ऐप खुला हो।

पहली बार Settings → "🔔 नोटिफिकेशन अनुमति दें" दबाना ज़रूरी है (Android 13+ पर
POST_NOTIFICATIONS की अनुमति माँगी जाती है)।

---

## रोज़ के काम के commands

```bash
npm run dev           # लोकल डेवलपमेंट
npm run build         # वेब build (dist/)
npm run sync          # build + Capacitor sync
npm run apk           # debug APK
npm run apk:release   # signed APK (keystore.properties चाहिए)
npm run rules:deploy  # Firestore rules
```

Web ऐप हर push पर GitHub Pages ([`deploy.yml`](.github/workflows/deploy.yml)) और
Netlify दोनों पर अपने आप चढ़ जाता है।
