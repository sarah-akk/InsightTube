require('dotenv').config();

const { chromium } = require('playwright');
const { YoutubeTranscript } = require('youtube-transcript');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const { OpenAI } = require("openai");

// ===== CONFIG =====
const { GEMINI_API_KEY, OPENROUTER_API_KEY, OPENROUTER_BASE_URL } = process.env;

if (!GEMINI_API_KEY || !OPENROUTER_API_KEY) {
    console.error('❌ عيّن GEMINI_API_KEY و OPENROUTER_API_KEY في ملف .env (انظر .env.example)');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

const client = new OpenAI({
    baseURL: OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: OPENROUTER_API_KEY,
    timeout: 120000, 
});

// ==================

async function getTranscript(videoId) {
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        const text = transcript.map(x => x.text).join(' ');
        console.log("transcript length:", text.length);
        return text;
    } catch (err) {
        console.error("❌ Transcript error:", err.message);
        return null;
    }
}
// ==================


// async function summarize(title, text) {

//     const completion =
//         await client.chat.completions.create({

//             model: "poolside/laguna-s-2.1:free",
//             messages: [
//             {
//                 role: "user",
//                 content: `
//                 لخص هذا الفيديو بالعربية.

//                 العنوان:
//                 ${title}

//                 النص:
//                 ${text}
// `
//             }
//         ]
//     });

//     return completion.choices[0].message.content;
// }

// async function summarize(title, text) {
//     const prompt = `
//         لخص هذا الفيديو بالعربية.

//         العنوان:
//         ${title}

//         النص:
//         ${text}
//         `;

//     const result = await model.generateContent(prompt);

//     return result.response.text();
// }

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

// "-----------------------------------------------------------------------------------------------------------------"

(async () => {
    const browser = await chromium.launchPersistentContext(
        './youtube-session',
        { 
            headless: false,
            args: ['--no-restore-last-session']
        }
    );
    
    const page = await browser.newPage();

    await page.goto('https://www.youtube.com', {
        timeout: 120000,
        waitUntil: 'domcontentloaded'
    });

    const rawCookies = JSON.parse(fs.readFileSync('./cookies.json', 'utf-8'));
    const cookies = rawCookies.map(cookie => ({
        ...cookie,
        domain: '.youtube.com',
        sameSite: ['Strict', 'Lax', 'None'].includes(cookie.sameSite)
            ? cookie.sameSite
            : 'None'
    }));
    
    await browser.addCookies(cookies);
    
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

            try {
                summary = await summarize(video.title, transcript);
            } catch (err) {
                console.error("❌ Summarization failed:", err.message);
            }
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

