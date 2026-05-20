import pg from 'pg';
import fetch from 'node-fetch';

const { Client } = pg;

const ALLOWED_TOPICS = [
  'Daily Life',
  'Work & Business',
  'Travel',
  'Food & Dining',
  'Emotions',
  'Technology',
  'Education',
  'Health',
  'Relationships',
  'Culture',
  'Slang & Idioms',
  'Academic',
  'Uncategorized',
];

const LLM_URL = 'http://localhost:8002';

const db = new Client({
  host: 'localhost',
  port: 5432,
  user: 'dictionary_user',
  password: 'dictionary_pass',
  database: 'speaking_app',
});

async function classifyTopic(word) {
  const topicList = ALLOWED_TOPICS.filter(t => t !== 'Uncategorized').join(', ');
  const systemPrompt = `Classify the English word "${word}" into exactly one of these categories: ${topicList}, Uncategorized.
Return ONLY valid JSON: { "topic": "Category Name" }`;

  try {
    const res = await fetch(`${LLM_URL}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: systemPrompt,
        messages: [{ role: 'user', content: `Classify: "${word}"` }],
      }),
    });
    const json = await res.json();
    let text = json?.response_text || json?.text || '';
    if (typeof text === 'string') {
      text = text.replace(/```json\n?|\n?```/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return 'Uncategorized';
      const parsed = JSON.parse(match[0]);
      const topic = parsed?.topic;
      return ALLOWED_TOPICS.includes(topic) ? topic : 'Uncategorized';
    }
    return 'Uncategorized';
  } catch {
    return 'Uncategorized';
  }
}

async function main() {
  await db.connect();

  const { rows } = await db.query(`
    SELECT id, data->>'word' AS word, data->>'topic' AS topic
    FROM dictionary.cache
    WHERE data->>'topic' IS NOT NULL
  `);

  const toReclassify = rows.filter(r => !ALLOWED_TOPICS.includes(r.topic));
  console.log(`Total cached words: ${rows.length}`);
  console.log(`Need reclassification: ${toReclassify.length}`);

  if (toReclassify.length === 0) {
    console.log('Nothing to do.');
    await db.end();
    return;
  }

  let ok = 0, fail = 0;
  for (const row of toReclassify) {
    const newTopic = await classifyTopic(row.word);
    await db.query(
      `UPDATE dictionary.cache SET data = jsonb_set(data, '{topic}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(newTopic), row.id],
    );
    console.log(`  [${newTopic}] ${row.word}  (was: ${row.topic})`);
    if (newTopic !== 'Uncategorized') ok++; else fail++;
    // small delay to not spam LLM
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nDone: ${ok} classified, ${fail} fell back to Uncategorized`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
