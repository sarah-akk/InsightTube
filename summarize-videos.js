require('dotenv').config();

const fs = require('fs');
const { OpenAI } = require('openai');

const INPUT_FILE = './transcripts.json';
const DASHBOARD_FILE = './insighttube-dashboard.html';

const { OPENROUTER_API_KEY, OPENROUTER_BASE_URL } = process.env;

if (!OPENROUTER_API_KEY) {
    console.error('❌ عيّن OPENROUTER_API_KEY في ملف .env (انظر .env.example)');
    process.exit(1);
}

if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ لم يُوجد ${INPUT_FILE}. شغّل أولاً: node fetch-transcripts.js`);
    process.exit(1);
}

const client = new OpenAI({
    baseURL: OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: OPENROUTER_API_KEY,
    timeout: 1200000,
});

async function summarize(title, text) {
    const completion = await client.chat.completions.create({
        model: 'nvidia/nemotron-3-super-120b-a12b',
        messages: [
            {
                role: 'user',
                content: `
                لخص هذا الفيديو بالعربية.

                العنوان:
                ${title}

                النص:
                ${text}
`,
            },
        ],
    });

    return completion.choices[0].message.content;
}

(async () => {
    const videos = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
    const results = [];

    console.log(`\n🔄 جاري تلخيص ${videos.length} فيديوهات من ${INPUT_FILE}...\n`);
    console.log('='.repeat(60));

    for (let i = 0; i < videos.length; i++) {
        const video = videos[i];

        console.log(`\n[${i + 1}/${videos.length}] 🎬 ${video.title}`);
        console.log(`    📡 القناة: ${video.channel || 'غير معروف'}`);
        console.log(`    🔗 ${video.url}`);

        let summary = null;

        if (video.hasTranscript && video.transcript) {
            console.log(`    ✅ نص متاح (${video.transcript.length} حرف)`);
            console.log(`    🤖 جاري التلخيص عبر OpenRouter...`);

            try {
                summary = await summarize(video.title, video.transcript);
                console.log(`\n    📝 الملخص:\n`);
                console.log(`    ${summary.split('\n').join('\n    ')}`);
            } catch (err) {
                console.error(`    ❌ Summarization failed: ${err.message}`);
            }
        } else {
            console.log(`    ⚠️  لا يوجد transcript لهذا الفيديو`);
        }

        results.push({
            title: video.title,
            url: video.url,
            channel: video.channel,
            videoId: video.videoId,
            hasTranscript: !!video.hasTranscript,
            summary: summary || 'لا يوجد transcript متاح',
        });

        console.log('='.repeat(60));
    }

    console.log('\n\n📊 النتائج النهائية:');
    console.log(JSON.stringify(results, null, 2));
    console.log(`\n✅ تم معالجة ${results.length} فيديوهات`);
    console.log(`📝 فيديوهات مع transcript: ${results.filter(r => r.hasTranscript).length}`);
    console.log(`❌ فيديوهات بدون transcript: ${results.filter(r => !r.hasTranscript).length}`);

    const html = fs.readFileSync(DASHBOARD_FILE, 'utf-8');
    const finalHtml = html.replace(
        /const DATA = \[[\s\S]*?\];/,
        `const DATA = ${JSON.stringify(results, null, 2)};`
    );
    fs.writeFileSync(DASHBOARD_FILE, finalHtml);

    console.log(`\n✅ تم تحديث الواجهة: افتح ${DASHBOARD_FILE} في المتصفح`);
})();
