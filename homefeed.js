require('dotenv').config();

const { chromium } = require('playwright');
const { YoutubeTranscript } = require('youtube-transcript');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const { OpenAI } = require("openai");
const UserAgent = require('user-agents');

// ===== CONFIG =====
const { GEMINI_API_KEY, OPENROUTER_API_KEY, OPENROUTER_BASE_URL } = process.env;

const MANUAL_LOGIN_TIMEOUT = 90_000; //90s

if (!GEMINI_API_KEY || !OPENROUTER_API_KEY) {
    console.error('❌ عيّن GEMINI_API_KEY و OPENROUTER_API_KEY في ملف .env (انظر .env.example)');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const client = new OpenAI({
    baseURL: OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: OPENROUTER_API_KEY,
});

// ==================

async function getTranscript(videoId) {
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        const text = transcript.map(x => x.text).join(' ');
        return text;
    } catch (err) {
        return null; 
    }
}

// ==================


async function summarize(title, text) {

    const completion =
        await client.chat.completions.create({

            model: "nvidia/nemotron-3-super-120b-a12b:free",
            messages: [
            {
                role: "user",
                content: `
                لخص هذا الفيديو بالعربية.

                العنوان:
                ${title}

                النص:
                ${text}
`
            }
        ]
    });

    return completion.choices[0].message.content;
}

// I stole this off Stackoverflow
async function auth(){
    const optionsBrowser = {
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-web-security',
            '--disable-infobars',
            '--disable-extensions',
            '--start-maximized',
            '--window-size=1280,720',
        ],
    };
    const browser = await chromium.launch(optionsBrowser);

    const optionsContext = {
        userAgent: new UserAgent([/Chrome/i, { deviceCategory: 'desktop' }]).userAgent,
        locale: 'en-US',
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
    };

    const context = await browser.newContext(optionsContext);
    const page = await context.newPage();
    await page.goto('https://accounts.google.com/');

    // Give 90 seconds to complete the manual login.
    const waitTime = MANUAL_LOGIN_TIMEOUT;
    console.log(`You have ${waitTime / 1000} seconds to complete the manual login...`);
    await page.waitForTimeout(waitTime);
    await page.goto('https://www.youtube.com', {
        timeout: 120000,
        waitUntil: 'domcontentloaded'
    });

    // Save the session
    await page.context().storageState({ path: 'cookies.json' });
    console.log('Session saved in cookies.json');

    await browser.close();
}

// "-----------------------------------------------------------------------------------------------------------------"

(async () => {
    if(! fs.existsSync('cookies.json')){
        await auth();
    }
    const browser = await chromium.launch(
        './youtube-session',
        { 
            headless: true,
            args: ['--no-restore-last-session']
        }
    );

    const context = await browser.newContext({
        storageState: 'cookies.json'
    });
    
    const page = await context.newPage();

    await page.goto('https://www.youtube.com', {
        timeout: 120000,
        waitUntil: 'domcontentloaded'
    });

    
    try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
        console.log('reload timed out, continuing...');
    }


   // "------------********************************--------------------"

// (async () => {
//     // ===== STEP 1: فتح YouTube وجلب الفيديوهات =====
//     const browser = await chromium.launchPersistentContext(
//         './youtube-session',
//         { headless: false }
//     );

//     const page = await browser.newPage();

//     await page.goto('https://www.youtube.com', {
//         timeout: 60000,
//         waitUntil: 'domcontentloaded'
//     });

//     // التحقق من تسجيل الدخول
//     const isLoggedIn = await page.$('ytd-rich-item-renderer');

//     if (!isLoggedIn) {
//         console.log('📋 سجّل دخولك في نافذة المتصفح...');
//         await page.waitForSelector('ytd-rich-item-renderer', { timeout: 120000 });
//         console.log('✅ تم تسجيل الدخول! الجلسة محفوظة.');
//     } else {
//         console.log('✅ مسجّل دخول من الجلسة السابقة!');
//     }

 // "-----------------------------------------------------------------------------------------------------------------"

     await page.waitForTimeout(5000);


    const videos = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer'));
        return items.map(item => {
            const watchLinks = Array.from(item.querySelectorAll('a'))
                .filter(a => a.href?.includes('/watch?v='));

            const titleLink = watchLinks.find(a => {
                const text = a.textContent?.trim();
                return text && !/^\d+:\d+(:\d+)?$/.test(text);
            });

            const anyWatchLink = watchLinks[0];
            const channelLink = Array.from(item.querySelectorAll('a'))
                .find(a => a.href?.includes('/@') || a.href?.includes('/channel/'));

            return {
                title: titleLink?.textContent?.trim(),
                url: anyWatchLink?.href?.split('&pp=')[0],
                channel: channelLink?.textContent?.trim(),
            };
        });
    });
// ==================

    const validVideos = videos.filter(v =>
        v.title &&
        v.url &&
        v.title !== 'ميكس' &&
        !/^\d+:\d+(:\d+)?$/.test(v.title) &&
        !v.url.includes('start_radio=1')
    );

    console.log(`\n📺 وجدت ${validVideos.length} فيديو على الصفحة الرئيسية`);
    await browser.close();

    const videosToProcess = validVideos;
    const results = [];

    console.log(`\n🔄 جاري معالجة ${videosToProcess.length} فيديوهات...\n`);
    console.log('='.repeat(60));

// ==================

    for (let i = 0; i < videosToProcess.length; i++) {
        const video = videosToProcess[i];
        const videoId = new URL(video.url).searchParams.get('v');

        console.log(`\n[${i + 1}/${videosToProcess.length}] 🎬 ${video.title}`);
        console.log(`    📡 القناة: ${video.channel || 'غير معروف'}`);
        console.log(`    🔗 ${video.url}`);


        console.log(`    ⏳ جاري جلب النص...`);
        const transcript = await getTranscript(videoId);

        let summary = null;

        if (transcript) {
            console.log(`    ✅ تم جلب النص (${transcript.length} حرف)`);
            console.log(`    🤖 جاري التلخيص بـ Gemini...`);
            summary = await summarize(video.title, transcript);
            console.log(`\n    📝 الملخص:\n`);
            console.log(`    ${summary.split('\n').join('\n    ')}`);
        } else {
            console.log(`    ⚠️  لا يوجد transcript لهذا الفيديو`);
        }

        results.push({
            ...video,
            videoId,
            hasTranscript: !!transcript,
            summary: summary || 'لا يوجد transcript متاح'
        });

        console.log('='.repeat(60));
    }


    console.log('\n\n📊 النتائج النهائية:');
    console.log(JSON.stringify(results, null, 2));
    console.log(`\n✅ تم معالجة ${results.length} فيديوهات`);
    console.log(`📝 فيديوهات مع transcript: ${results.filter(r => r.hasTranscript).length}`);
    console.log(`❌ فيديوهات بدون transcript: ${results.filter(r => !r.hasTranscript).length}`);


    // ==================


    const html = fs.readFileSync('./insighttube-dashboard.html', 'utf-8');

    const finalHtml = html.replace(
    /const DATA = \[[\s\S]*?\];/,
    `const DATA = ${JSON.stringify(results, null, 2)};`
    );
    fs.writeFileSync('./insighttube-dashboard.html', finalHtml);
    console.log('✅ تم تحديث الواجهة: افتح insighttube-dashboard.html في المتصفح');

})();

