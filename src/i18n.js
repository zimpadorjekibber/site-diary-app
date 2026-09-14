// src/i18n.js
// Bilingual Support (Hindi / English) for Shram & Site Diary

export const translations = {
  hi: {
    appTitle: 'श्रम और साइट डायरी',
    todayExpense: 'आज का साइट खर्च (Total Spent Today)',
    diaryPending: 'डायरी बाकी ⏳',
    diaryDone: 'डायरी पूरी ✓',
    metricCash: 'नकद पेशगी',
    metricRation: 'ग्रुप राशन',
    metricHaziri: 'आज हाजिरी',
    quickEntryPlaceholder: 'लिखें: रमेश 500 नकद या बोलने के लिए 🎙️ दबाएं',
    quickEntryBtn: 'जोड़ें ➔',
    voiceListening: 'आपकी आवाज़ सुनी जा रही है...',

    // Quick action tiles
    tileAddWorker: '+ नया कारीगर',
    tileAddWorkerSub: 'मिस्त्री / हेल्पर जोड़ें',
    tileCash: 'नकद / पेशगी',
    tileCashSub: 'व्यक्तिगत एडवांस',
    tileRation: 'ग्रुप राशन',
    tileRationSub: 'आटा, चावल, सिलेंडर',
    tileRecharge: 'मोबाइल रिचार्ज',
    tileRechargeSub: 'कारीगर का रिचार्ज',
    tileAddTrade: '+ नया ट्रेड',
    tileAddTradeSub: 'श्रेणी / ग्रुप जोड़ें',

    // Nav tabs
    tabTimeline: 'लेन-देन',
    tabHaziri: 'दैनिक हाजिरी',
    tabMonthly: 'मस्टर रोल',
    tabGroups: 'कारीगर खाता',
    tabDiary: 'शाम डायरी',

    // Filters
    filterAll: 'सभी प्रकार (All)',
    filterCash: '💵 नकद',
    filterRation: '🍚 राशन',
    filterRecharge: '📱 रिचार्ज',
    filterCylinder: '🔥 सिलेंडर',
    filterDiesel: '⛽ डीजल',
    filterMaterial: '🧱 सामान',
    filterOther: '📝 अन्य',
    filterAdd: '+ जोड़ें',

    // Daily Haziri
    haziriDateLabel: 'तारीख चुनें:',
    btnMonthlyView: '📊 पूरे महीने की हाजिरी देखें →',
    btnAddTrade: '🏷️ + नया ट्रेड',
    btnAddWorker: '+ नया कारीगर / हेल्पर जोड़ें',

    // Monthly
    monthlyTitle: '📊 पूरे महीने का हाजिरी रजिस्टर (Muster Roll)',
    monthlyDesc: '1 तारीख से 30/31 तारीख तक सभी कारीगरों (मिस्त्री, हेल्पर, ठेका) की पूरी हाजिरी, गैरहाजिरी और बकाया एक साथ देखें।',

    // Evening Diary
    diaryTitle: '📖 शाम की डायरी (Evening Diary Slip)',
    diaryDesc: 'आज पूरे दिन का हिसाब अपनी डायरी में नोट करने के लिए:',
    btnCopyDiary: '📋 डायरी नोट कॉपी करें',
    btnShareDiaryWA: '📲 WhatsApp पर भेजें',
    btnExportPdf: '📑 PDF / प्रिंट',
    diaryPrompt: 'क्या आपने इसे अपनी डायरी में नोट कर लिया?',
    diaryPromptDesc: 'डायरी में नोट करने के बाद नीचे बटन दबाएं ताकि शाम का रिमाइंडर शांत हो जाए।',
    btnMarkNoted: '✓ डायरी में लिख लिया!',

    // Settings
    settingsTitle: '⚙️ ऐप सेटिंग्स व मास्टर प्रबंधन',
    clearDemoLabel: '🧹 डमी डेटा साफ़ करें (Start Fresh):',
    btnClearDemo: '🧹 सभी डमी कारीगर व लेन-देन हटाएँ — नया असली खाता शुरू करें',
    clearDemoDesc: 'सैंपल कारीगर (Ramesh, Mohan आदि) और फर्जी खर्चे एक क्लिक में हट जाएंगे। आपकी ट्रेड श्रेणियां सुरक्षित रहेंगी।',
    manageWorkers: '👷 कारीगर प्रबंधन (Manage Workers):',
    manageWorkersDesc: 'यदि किसी कारीगर को गलती से गलत ग्रुप में डाल दिया है (जैसे Mason को Carpenter), तो नीचे से चुनें और "सुधारें" दबाएं:',
    btnEditWorkerSettings: '✏️ सुधारें / ग्रुप बदलें',
    manageTrades: '🏷️ कारीगर ट्रेड / श्रेणियां (Trades):',
    tradesDesc: 'आपकी साइट पर सक्रिय काम के ग्रुप:',
    manageTxTypes: '💳 लेन-देन के प्रकार (Transaction Types):',
    txTypesDesc: 'मौजूदा लेन-देन श्रेणियां:',
    btnAddType: '+ नया प्रकार जोड़ें',
    eveningReminder: '⏰ शाम का रिमाइंडर व अलार्म (Evening Reminder):',
    reminderTimeLabel: 'डायरी याद दिलाने का समय:',
    browserNotifLabel: 'ब्राउज़र पुश नोटिफिकेशन:',
    btnEnableNotif: '🔔 नोटिफिकेशन अनुमति दें',
    audioChimeLabel: 'मधुर घंटी की आवाज (Audio Chime):',
    btnTestChime: '🔔 अभी टेस्ट करें (Test Reminder Chime & Alert)',
    btnSaveSettings: 'सेटिंग्स सेव करें',
    btnClose: 'बंद करें',
    btnCancel: 'रद्द करें'
  },
  en: {
    appTitle: 'Labour & Site Diary',
    todayExpense: "Today's Site Expense (Total Spent)",
    diaryPending: 'Diary Pending ⏳',
    diaryDone: 'Diary Done ✓',
    metricCash: 'Cash Advance',
    metricRation: 'Group Ration',
    metricHaziri: 'Today Attendance',
    quickEntryPlaceholder: 'Type: Ramesh 500 cash or tap 🎙️ to speak',
    quickEntryBtn: 'Add ➔',
    voiceListening: 'Listening to your voice...',

    // Quick action tiles
    tileAddWorker: '+ New Worker',
    tileAddWorkerSub: 'Add Mistri / Helper',
    tileCash: 'Cash / Advance',
    tileCashSub: 'Individual Advance',
    tileRation: 'Group Ration',
    tileRationSub: 'Flour, Rice, Cylinder',
    tileRecharge: 'Mobile Recharge',
    tileRechargeSub: 'Worker Recharge',
    tileAddTrade: '+ New Trade',
    tileAddTradeSub: 'Add Category / Group',

    // Nav tabs
    tabTimeline: 'Timeline',
    tabHaziri: 'Attendance',
    tabMonthly: 'Muster Roll',
    tabGroups: 'Worker Ledger',
    tabDiary: 'Evening Diary',

    // Filters
    filterAll: 'All Types',
    filterCash: '💵 Cash',
    filterRation: '🍚 Ration',
    filterRecharge: '📱 Recharge',
    filterCylinder: '🔥 Cylinder',
    filterDiesel: '⛽ Diesel',
    filterMaterial: '🧱 Material',
    filterOther: '📝 Other',
    filterAdd: '+ Add',

    // Daily Haziri
    haziriDateLabel: 'Select Date:',
    btnMonthlyView: '📊 View Full Month Attendance →',
    btnAddTrade: '🏷️ + New Trade',
    btnAddWorker: '+ Add New Worker / Helper',

    // Monthly
    monthlyTitle: '📊 Monthly Attendance Register (Muster Roll)',
    monthlyDesc: 'View entire month attendance, absence, overtime and balance due for all workers in one sheet.',

    // Evening Diary
    diaryTitle: '📖 Evening Site Diary Slip',
    diaryDesc: 'Summary to note in your physical diary at end of day:',
    btnCopyDiary: '📋 Copy Diary Note',
    btnShareDiaryWA: '📲 Send via WhatsApp',
    btnExportPdf: '📑 Print / PDF',
    diaryPrompt: 'Have you noted this in your physical diary?',
    diaryPromptDesc: 'Tap below after noting down so evening reminder stays quiet.',
    btnMarkNoted: '✓ Written in Diary!',

    // Settings
    settingsTitle: '⚙️ App Settings & Master Data',
    clearDemoLabel: '🧹 Clear Demo Data (Start Fresh):',
    btnClearDemo: '🧹 Remove All Demo Workers & Transactions — Start Fresh',
    clearDemoDesc: 'Sample workers and fake expenses will be removed. Custom trades will be preserved.',
    manageWorkers: '👷 Manage Workers:',
    manageWorkersDesc: 'If a worker was accidentally assigned to wrong group, select and click "Edit":',
    btnEditWorkerSettings: '✏️ Edit / Change Group',
    manageTrades: '🏷️ Work Trades & Categories:',
    tradesDesc: 'Active work trades on your site:',
    manageTxTypes: '💳 Transaction Categories:',
    txTypesDesc: 'Available transaction types:',
    btnAddType: '+ Add New Type',
    eveningReminder: '⏰ Evening Reminder & Chime:',
    reminderTimeLabel: 'Time to remind you in the evening:',
    browserNotifLabel: 'Browser Push Notification:',
    btnEnableNotif: '🔔 Allow Notifications',
    audioChimeLabel: 'Pleasant Audio Chime:',
    btnTestChime: '🔔 Test Reminder Now',
    btnSaveSettings: 'Save Settings',
    btnClose: 'Close',
    btnCancel: 'Cancel'
  }
};
