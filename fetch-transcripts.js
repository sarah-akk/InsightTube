require('dotenv').config();

const { chromium } = require('playwright');
const { YoutubeTranscript } = require('youtube-transcript');
const fs = require('fs');

const OUTPUT_FILE = './transcripts.json';

async function getTranscript(videoId) {
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        const text = transcript.map(x => x.text).join(' ');
        console.log(`    transcript length: ${text.length}`);
        return text;
    } catch (err) {
        console.error(`    ❌ Transcript error: ${err.message}`);
        return null;
    }
}

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

    const validVideos = videos.filter(v =>
        v.title &&
        v.url &&
        v.title !== 'ميكس' &&
        !/^\d+:\d+(:\d+)?$/.test(v.title) &&
        !v.url.includes('start_radio=1')
    );

    console.log(`\n📺 وجدت ${validVideos.length} فيديو على الصفحة الرئيسية`);
    await browser.close();

    const results = [];

    console.log(`\n🔄 جاري جلب النصوص لـ ${validVideos.length} فيديوهات...\n`);
    console.log('='.repeat(60));

    for (let i = 0; i < validVideos.length; i++) {
        const video = validVideos[i];
        const videoId = new URL(video.url).searchParams.get('v');

        console.log(`\n[${i + 1}/${validVideos.length}] 🎬 ${video.title}`);
        console.log(`    📡 القناة: ${video.channel || 'غير معروف'}`);
        console.log(`    🔗 ${video.url}`);
        console.log(`    ⏳ جاري جلب النص...`);

        const transcript = await getTranscript(videoId);

        if (transcript) {
            console.log(`    ✅ تم جلب النص (${transcript.length} حرف)`);
        } else {
            console.log(`    ⚠️  لا يوجد transcript لهذا الفيديو`);
        }

        results.push({
            ...video,
            videoId,
            hasTranscript: !!transcript,
            transcript: transcript || null,
        });

        console.log('='.repeat(60));
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');

    console.log(`\n✅ تم حفظ ${results.length} فيديو في ${OUTPUT_FILE}`);
    console.log(`📝 مع transcript: ${results.filter(r => r.hasTranscript).length}`);
    console.log(`❌ بدون transcript: ${results.filter(r => !r.hasTranscript).length}`);
    console.log(`\n👉 الخطوة التالية: node summarize-videos.js`);
})();
