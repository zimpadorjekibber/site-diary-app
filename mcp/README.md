# Site Diary MCP — साइट का हिसाब Claude से पूछिए

अपनी साइट का डेटा Claude से सीधे सवाल-जवाब में पूछने के लिए। जैसे:

> "आज साइट पर कितना खर्च हुआ?"
> "रमेश का कितना बकाया है?"
> "इस महीने डीज़ल पर कितना गया?"
> "कल कौन-कौन गैरहाजिर था?"
> "कल साइट पर क्या हुआ था?"

और लिखवा भी सकते हैं:

> "विकिल अहमद की आज हाजिरी लगा दो"
> "नूर को 500 नकद दिए, लिख दो"
> "राजू नाम का मेसन हेल्पर जोड़ो, 550 दिहाड़ी"
> "लिख दो — 2:15 पर लाइट चली गई, काम नहीं हो रहा"

कारीगर हटाने का tool **दो कदम में** चलता है। पहली बार वो कुछ मिटाता नहीं — सिर्फ़ बताता है
कि कितने दिन की हाजिरी जाएगी और कितना पैसा हिसाब में बना रहेगा। हटाने के लिए पूरा नाम
दोबारा देना पड़ता है — खाली "हाँ" काफ़ी नहीं, ताकि ग़लत समझे गए वाक्य से कोई मिट न जाए।

**हिसाब पूरा साफ़ करने का कोई tool नहीं है** — वो काम ऐप में है, जहाँ पूछकर होता है।

---

# फ़ोन से — Remote MCP

ऊपर वाला तरीक़ा तभी चलता है जब कंप्यूटर पर यह फ़ोल्डर मौजूद हो। फ़ोन के Claude ऐप में
वो नहीं चलेगा — क्योंकि Claude आपके फ़ोन से नहीं, **Anthropic के सर्वर से** जुड़ता है।
इसलिए server को इंटरनेट पर होना पड़ता है।

वही tools, वही गणना — बस HTTPS पर: [`netlify/functions/mcp.js`](../netlify/functions/mcp.js)।
Tools दोबारा नहीं लिखे गए, दोनों [`mcp/tools.js`](./tools.js) से ही आते हैं।

> **कहाँ चलता है:** यह endpoint **Vercel** पर है, वेबसाइट Netlify पर।
> दोनों को अलग रखा है क्योंकि Netlify के मुफ़्त plan में महीने के 20 deploy मिलते हैं,
> और यह फ़ाइल दिन में कई बार बदलती है — एक दिन में पूरा कोटा ख़त्म हो चुका है।
> वेबसाइट कभी-कभार बदलती है, इसलिए वो वहीं ठीक है।

## एक बार का सेटअप

### 1. एक गुप्त token बनाइए

यह आपका password है। इसे मुझे या किसी और को मत भेजिए।

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 2. Netlify में दो चीज़ें भरिए

**Site configuration → Environment variables:**

| नाम | क्या भरें |
|---|---|
| `SITE_DIARY_TOKEN` | ऊपर बना token |
| `SITE_DIARY_SITE_ID` | ऐप वाली `site-XXXX-XXXX` |

भरने के बाद एक बार **redeploy** कीजिए, वरना नई values नहीं पहुँचेंगी।

### 3. Claude में connector जोड़िए

**Settings → Connectors → Add custom connector**, और URL:

```
https://<आपकी-साइट>.netlify.app/mcp/<आपका-token>
```

बस। अब फ़ोन से पूछिए — "आज साइट पर कितना खर्च हुआ?"

## यहाँ सिर्फ़ पढ़ा जा सकता है

फ़ोन वाले रास्ते से **कुछ बदला नहीं जा सकता** — लिखने वाले tools दिखते ही नहीं।
वजह: stdio वाला server उसी मशीन पर चलता है जिसके सामने आप बैठे हैं; यह वाला इंटरनेट
पर है और जिसके पास token पहुँच जाए, उसी का हो जाता है। पढ़ना ग़लत हाथ में जाए तो
नुक़सान कम है, लिखना जाए तो डायरी ही बिगड़ सकती है।

लिखने की ज़रूरत हो तो Netlify में `SITE_DIARY_ALLOW_WRITE` = `1` कर दीजिए — सोच-समझकर।

## ध्यान रखने की बातें

⚠️ **URL ही password है।** जिसके पास वो पूरा URL है, वो आपकी पूरी डायरी पढ़ सकता है।
किसी को फ़ॉरवर्ड मत कीजिए, screenshot में मत आने दीजिए।

⚠️ **लीक हो जाए तो:** Netlify में `SITE_DIARY_TOKEN` बदल दीजिए और redeploy कर दीजिए —
पुराना URL उसी वक़्त बेकार हो जाएगा। connector में नया URL डाल दीजिए।

Token header में भी भेजा जा सकता है (`Authorization: Bearer <token>`) — अगर connector
में header डालने की सुविधा हो तो वो बेहतर है, क्योंकि तब वो URL में नहीं दिखता।

| Env variable | डिफ़ॉल्ट |
|---|---|
| `SITE_DIARY_TOKEN` | *(ज़रूरी — न हो तो endpoint बंद रहता है)* |
| `SITE_DIARY_SITE_ID` | *(ज़रूरी)* |
| `SITE_DIARY_ALLOW_WRITE` | `0` — `1` करने पर लिखने वाले tools चालू |

## Reading a ledger that belongs to an account

Since ledgers became owned by a Google account, the security rules only answer
to that account. This server is not a person and cannot sign in as one, so to
read an owned ledger it needs a **service account**.

1. [Firebase Console](https://console.firebase.google.com/project/khalen-dairy/settings/serviceaccounts/adminsdk)
   → Project settings → **Service accounts** → **Generate new private key**
2. Save the downloaded JSON somewhere outside this repository — for example
   `C:\Users\<you>\site-diary-key.json`
3. Point the server at it:

```
SITE_DIARY_SERVICE_ACCOUNT=C:\Users\<you>\site-diary-key.json
SITE_DIARY_SITE_ID=site-XXXX-XXXX
```

The variable also accepts the JSON inline, but a path is better: it keeps the
key out of process listings and out of any config file that gets shared.

**That key reads and writes every ledger in the project, above the security
rules.** Treat it like the keystore password: never commit it, never paste it
into a chat, and revoke it in the console if it leaks.

Without the variable the server falls back to the public API key, which can
still read a ledger nobody has claimed — old sites and test data only.
