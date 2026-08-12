const DEFAULT_DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

function getAIProviderConfig() {
  const provider = String(process.env.AI_PROVIDER || 'deepseek').toLowerCase().trim();
  return {
    provider,
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
      baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
      maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 900),
      temperature: Number(process.env.DEEPSEEK_TEMPERATURE || 0.35)
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
      model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-haiku-4-5',
      maxTokens: Number(process.env.CLAUDE_MAX_TOKENS || 900),
      temperature: Number(process.env.CLAUDE_TEMPERATURE || 0.35)
    }
  };
}

function normalizeAIText(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function buildStudentTutorSystemPrompt() {
  return [
    'You are Shule AI Tutor for Kenyan school learners.',
    'Give safe, age-appropriate, curriculum-aware help.',
    'Do not ask for private personal data, phone numbers, passwords, payment details, or home addresses.',
    'Do not change marks, fees, attendance, homework submissions, or school records.',
    'Explain step by step using simple language, then give a short practice question when useful.',
    'If the learner asks for direct cheating or harmful content, refuse gently and redirect to learning.'
  ].join(' ');
}

function buildAlertSuggestionSystemPrompt() {
  return [
    'You are Shule AI, an assistant that helps school admins write clear announcements and parent alerts.',
    'Write concise, respectful, professional messages suitable for parents, teachers, students, or the whole school in Kenya.',
    'Do not include threats, shame, sensitive student details, or private financial details beyond the user provided summary.',
    'Return JSON only with key options. options must be an array of 2 or 3 objects.',
    'Each option must have: title, platformMessage, smsMessage, tone. SMS message must be under 155 characters.',
    'Also include a short reason field. Do not send automatically; admin reviews first.'
  ].join(' ');
}

async function callDeepSeekChat({ messages, maxTokens, temperature, responseFormat }) {
  const config = getAIProviderConfig().deepseek;
  if (!config.apiKey) {
    const err = new Error('DeepSeek API key is not configured on the backend');
    err.status = 503;
    throw err;
  }
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: Number.isFinite(temperature) ? temperature : config.temperature,
      max_tokens: maxTokens || config.maxTokens,
      ...(responseFormat ? { response_format: responseFormat } : {})
    })
  });
  const bodyText = await response.text();
  let body;
  try { body = JSON.parse(bodyText); } catch (_) { body = { raw: bodyText }; }
  if (!response.ok) {
    const err = new Error(body?.error?.message || body?.message || bodyText || 'DeepSeek request failed');
    err.status = response.status;
    err.provider = 'deepseek';
    throw err;
  }
  const content = normalizeAIText(body?.choices?.[0]?.message?.content || '');
  return {
    text: content,
    provider: 'deepseek',
    model: body?.model || config.model,
    usage: body?.usage || {}
  };
}

async function callAnthropicTutor({ question, subject, grade, curriculum, command, topic, studentContext }) {
  const { callClaudeTutor } = require('./claudeTutorService');
  const text = await callClaudeTutor({ question, subject, grade, curriculum, command, topic, studentContext });
  return {
    text: normalizeAIText(text),
    provider: 'anthropic',
    model: getAIProviderConfig().anthropic.model,
    usage: {}
  };
}

async function callStudentTutorAI({ question, subject, grade, curriculum, command, topic, studentContext }) {
  const cfg = getAIProviderConfig();
  const payload = {
    grade,
    curriculum,
    subject,
    topic,
    tutorMode: command || 'ask',
    learnerQuestion: question,
    learningContext: studentContext || {}
  };

  if (cfg.provider === 'anthropic' || cfg.provider === 'claude') {
    return callAnthropicTutor({ question, subject, grade, curriculum, command, topic, studentContext });
  }

  return callDeepSeekChat({
    messages: [
      { role: 'system', content: buildStudentTutorSystemPrompt() },
      { role: 'user', content: JSON.stringify(payload, null, 2) }
    ]
  });
}


function conciseSms(text) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 155); }
function titleCaseTopic(topic) {
  return String(topic || 'School announcement').replace(/_/g, ' ').replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function localAnnouncementOptions({ audience, topic, description, schoolName }) {
  const audienceText = String(audience || 'parents').replace(/_/g, ' ');
  const topicTitle = titleCaseTopic(topic || 'Announcement');
  const brief = String(description || '').trim().replace(/\s+/g, ' ');
  const school = schoolName || 'the school';
  return [
    {
      title: `${topicTitle} Notice`,
      tone: 'Professional',
      platformMessage: `Dear ${audienceText}, ${school} kindly requests your attention regarding ${topicTitle.toLowerCase()}. ${brief}. Thank you for your cooperation and continued support.`,
      smsMessage: conciseSms(`${topicTitle}: ${brief}. Thank you.`)
    },
    {
      title: `Kind Reminder: ${topicTitle}`,
      tone: 'Friendly',
      platformMessage: `Hello ${audienceText}, this is a kind reminder from ${school}: ${brief}. We appreciate your support and partnership.`,
      smsMessage: conciseSms(`Kind reminder: ${brief}. Thank you for your support.`)
    },
    {
      title: `Important ${topicTitle}`,
      tone: 'Short / Direct',
      platformMessage: `Important update: ${brief}. Please take the necessary action as soon as possible.`,
      smsMessage: conciseSms(`Important: ${brief}`)
    }
  ];
}
function dedupeAnnouncementOptions(options, fallbackContext) {
  const fallback = localAnnouncementOptions(fallbackContext);
  const seen = new Set();
  const cleaned = [];
  for (const raw of [...(Array.isArray(options) ? options : []), ...fallback]) {
    const title = String(raw.title || '').trim() || fallback[cleaned.length % fallback.length].title;
    const platformMessage = String(raw.platformMessage || raw.message || '').trim() || fallback[cleaned.length % fallback.length].platformMessage;
    const smsMessage = conciseSms(raw.smsMessage || raw.sms || platformMessage || fallback[cleaned.length % fallback.length].smsMessage);
    const tone = String(raw.tone || fallback[cleaned.length % fallback.length].tone || '').trim();
    const signature = platformMessage.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
    if (seen.has(signature)) continue;
    seen.add(signature);
    cleaned.push({ title, platformMessage, smsMessage, tone });
    if (cleaned.length === 3) break;
  }
  return cleaned;
}

async function generateParentAlertSuggestion({ audience, topic, tone, description, schoolName, extraContext }) {
  const userPrompt = {
    audience: audience || 'parents',
    topic: topic || 'General announcement',
    tone: tone || 'Professional',
    schoolName: schoolName || 'the school',
    briefDescription: description || '',
    extraContext: extraContext || {},
    instructions: 'Generate 2 or 3 ready-to-use announcement options. Each option must include a title, a detailed platform alert version, and a short SMS version. AI only drafts; the admin must review and press Send.'
  };
  let result;
  try {
    result = await callDeepSeekChat({
      messages: [
        { role: 'system', content: buildAlertSuggestionSystemPrompt() },
        { role: 'user', content: JSON.stringify(userPrompt, null, 2) }
      ],
      maxTokens: 650,
      temperature: 0.35,
      responseFormat: { type: 'json_object' }
    });
  } catch (error) {
    const options = dedupeAnnouncementOptions([], { audience, topic, description, schoolName });
    return {
      title: options[0]?.title || `${topic || 'School'} Notice`,
      message: options[0]?.platformMessage || '',
      options,
      reason: 'Smart local templates generated because the AI provider is unavailable. Admin must review before sending.',
      provider: 'local_template',
      model: 'system_rules',
      usage: null,
      localFallback: true
    };
  }
  let parsed;
  try { parsed = JSON.parse(result.text); } catch (_) { parsed = null; }
  if (!parsed) parsed = { options: [] };
  let options = Array.isArray(parsed.options) ? parsed.options : [];
  if (!options.length && (parsed.title || parsed.message)) {
    options = [{ title: parsed.title || `${topic || 'School'} Notice`, platformMessage: parsed.platformMessage || parsed.message || result.text, smsMessage: parsed.smsMessage || String(parsed.message || result.text).slice(0,155), tone: parsed.tone || tone || 'Professional' }];
  }
  if (!options.length && Array.isArray(parsed.alternatives)) {
    options = parsed.alternatives.map((x, i) => ({ title: x.title || `${topic || 'School'} Option ${i+1}`, platformMessage: x.platformMessage || x.message || String(x), smsMessage: (x.smsMessage || x.message || String(x)).slice(0,155), tone: x.tone || tone || 'Professional' }));
  }
  options = dedupeAnnouncementOptions(options, { audience, topic, description, schoolName });
  return {
    title: options[0]?.title || `${topic || 'School'} Notice`,
    message: options[0]?.platformMessage || '',
    options,
    reason: parsed.reason || 'Generated by Shule AI from the admin brief. Admin must review before sending.',
    provider: result.provider,
    model: result.model,
    usage: result.usage
  };
}

module.exports = {
  getAIProviderConfig,
  callDeepSeekChat,
  callStudentTutorAI,
  generateParentAlertSuggestion
};
