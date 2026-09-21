# Play Store पर डालने के लिए

यह फ़ाइल उस दिन के लिए है जब ऐप स्टोर पर जाएगी। क्रम मायने रखता है: कुछ क़दम दूसरों के बिना
काम ही नहीं करते।

---

## ⚠️ सबसे पहले यह पढ़िए — SHA-1 वाला जाल

Play अपलोड की हुई फ़ाइल को **अपनी key से दोबारा sign करता है** (Play App Signing)। इसका मतलब
है कि स्टोर से इंस्टॉल हुई ऐप का SHA-1 वह **नहीं** होगा जो अभी Firebase में दर्ज है:

```
अभी दर्ज है (हमारी key):  47:29:C8:B7:0D:8F:03:93:74:25:67:C2:1E:E8:8A:0B:9A:9E:28:4D
```

उस SHA-1 से Google लॉगिन चलता है। Play की नई key जुड़े बिना, **स्टोर से इंस्टॉल की हुई ऐप में
लॉगिन फ़ेल होगा** — और वही "Sign-in failed" वाली उलझन दोबारा शुरू हो जाएगी।

**इलाज (Play Console पर ऐप बनाने के तुरंत बाद):**

1. Play Console → आपकी ऐप → **Test and release → Setup → App signing**
2. वहाँ **"App signing key certificate"** का SHA-1 दिखेगा — उसे कॉपी कीजिए
3. [Firebase project settings](https://console.firebase.google.com/project/khalen-dairy/settings/general)
   → Android ऐप → **Add fingerprint** → वही SHA-1 जोड़िए
4. **नई `google-services.json` डाउनलोड कीजिए**, `android/app/` में बदलिए, और नया बिल्ड बनाइए

दोनों SHA-1 एक साथ रह सकते हैं — पुरानी sideload वाली APK भी चलती रहेगी और स्टोर वाली भी।

---

## Google जो माँगेगा

| क़दम | हालत |
|---|---|
| Play Console developer account (एक बार की फ़ीस) | आपको बनाना है |
| **AAB** फ़ाइल | ✅ हो गया — हर रिलीज़ में `SiteDiary.aab` बनती है |
| **Privacy policy** एक पब्लिक लिंक पर | ✅ पेज बन गया — नीचे देखिए |
| Data safety form | भरना है — नीचे इसका जवाब तैयार है |
| Store listing: नाम, description, screenshots, icon | बनाना है |
| Content rating का सवालनामा | भरना है |
| **Closed testing: 12 tester × 14 दिन** | नए personal account पर Google की शर्त है |

### Privacy policy का लिंक

पेज `public/privacy.html` में है और GitHub Pages पर अपने आप चढ़ जाता है:

```
https://zimpadorjekibber.github.io/site-diary-app/privacy.html
```

> **एक काम बाक़ी:** उस पेज में संपर्क ईमेल की जगह अभी `[यहाँ अपना संपर्क ईमेल लिखें]` लिखा है।
> Play बिना संपर्क पते के पॉलिसी स्वीकार नहीं करता, इसलिए वहाँ अपना ईमेल भरना ज़रूरी है।

### Data safety form में क्या भरना है

ऐप जो इकट्ठा करती है, और उसका सच्चा जवाब:

- **Personal info → Name, Email address** — हाँ, इकट्ठा होता है (Google लॉगिन से)।
  मक़सद: *App functionality, Account management*। बेचा नहीं जाता, विज्ञापन के लिए नहीं।
- **Personal info → Phone number** — हाँ, पर यह *उपयोगकर्ता के कारीगरों* का होता है, जो वह ख़ुद
  दर्ज करता है। मक़सद: *App functionality*।
- **Photos** और **Audio** — हाँ, अगर उपयोगकर्ता जोड़े। मक़सद: *App functionality*।
- **Financial info → other** — हाँ (दिहाड़ी, भुगतान, खर्च)। मक़सद: *App functionality*।
- सब कुछ **encrypted in transit**: हाँ (Firestore HTTPS पर चलता है)।
- **Data deletion**: हाँ — पॉलिसी में ईमेल से हटवाने का रास्ता लिखा है।
- **Ads, analytics, tracking**: कोई नहीं।

---

## कोड में जो अभी बाक़ी है

1. **ऐप के अंदर से खाता हटाने का रास्ता।** Play की शर्त है: जो ऐप खाता बनाती है, उसे ऐप के
   अंदर और एक वेब लिंक से खाता हटाने का रास्ता देना होता है। अभी सिर्फ़ ईमेल वाला रास्ता है,
   जो शुरुआत में चल जाता है पर पक्का हल नहीं है।
2. **सिंक का तरीक़ा।** हर हाजिरी पर पूरा लेजर दोबारा लिखा जाता है, और एक साइट की सीमा 1 MB
   है। एक ठेकेदार के लिए चलता है; सैकड़ों उपयोगकर्ताओं पर यह महँगा भी है और फ़ोटो वाली साइट
   सीमा पार कर जाएगी।
3. **MCP endpoint।** वह बिना लॉगिन पढ़ता था, और rules कसने के बाद बंद है। इसे चलाना हो तो
   service account चाहिए।
4. **पहली बार खुलने वाला अनुभव** — अजनबी उपयोगकर्ता के लिए साफ़ शुरुआत।

---

## रिलीज़ बनाने का तरीक़ा

`main` पर push करते ही CI दोनों फ़ाइलें बनाकर GitHub release पर चढ़ा देता है:

- `SiteDiary.apk` — फ़ोन में सीधे इंस्टॉल करने के लिए
- `SiteDiary.aab` — Play Console पर अपलोड करने के लिए (फ़ोन में इंस्टॉल **नहीं** होती)

`versionCode` हर बिल्ड में बढ़ता है (GitHub run number), जो Play की शर्त है — एक बार अपलोड
किया हुआ versionCode दोबारा नहीं चलता।
