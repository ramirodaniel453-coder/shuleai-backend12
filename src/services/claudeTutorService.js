async function callClaudeTutor({ question, subject, grade, curriculum, command, topic, studentContext }) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;
  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
  const system = `You are Shule AI Tutor for school children. Be safe, age-appropriate, curriculum-aware, and concise. Do not diagnose health issues, do not give harmful instructions, and do not modify school data. If unsure, explain gently and ask the learner to check with their teacher.`;
  const user = JSON.stringify({ question, subject, grade, curriculum, command, topic, studentContext }, null, 2);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: Number(process.env.CLAUDE_MAX_TOKENS || 700), temperature: 0.3, system, messages: [{ role:'user', content: user }] })
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw:text }; }
  if (!response.ok) throw new Error(json.error?.message || json.message || text);
  return json.content?.map(c => c.text || '').join('\n').trim() || null;
}
module.exports = { callClaudeTutor };
