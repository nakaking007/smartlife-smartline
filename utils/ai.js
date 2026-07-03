// utils/ai.js
const axios = require('axios');
const config = require('../config');

const conversations = new Map();
const VALID_TEXT_PROVIDERS = ['gemini', 'groq', 'openrouter', 'huggingface', 'pollinations', 'ollama'];
const COMMON_TRANSLATIONS = new Map([
  ['ฉันรักเธอ', 'I love you'],
  ['ฉันรักคุณ', 'I love you'],
  ['ผมรักคุณ', 'I love you'],
  ['ผมรักเธอ', 'I love you']
]);

const SYSTEM_PROMPT = [
  'You are SmartLife AI inside a LINE bot for a Thai user.',
  'Reply primarily in Thai unless the user asks for another language.',
  'Be practical, concise, and honest. Do not invent current facts, prices, laws, medical claims, or emergency details.',
  'The app has deterministic appointment tools. Do not claim you created, edited, or deleted an appointment by yourself.',
  'Only mention appointment tools when the user asks about appointments, schedules, reminders, editing, or deleting appointments.',
  'If the user wants appointment changes, tell them to use เมนูหลัก, แผงนัดหมาย, แก้เวลา <ID> 15.00 น., or the appointment panel.',
  'Thailand time is always Asia/Bangkok in 24-hour format, for example 15.00 น.',
  'For health, legal, financial, and disaster topics, be careful and encourage checking official sources when appropriate.',
  'Do not use panic-inducing language.'
].join('\n');

function normalizeProviderList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
}

function hasThaiText(text) {
  return /[\u0E00-\u0E7F]/.test(String(text || ''));
}

function getRequestedProviderOrder() {
  const provider = String(config.aiProvider || 'auto').trim().toLowerCase();

  if (!provider || provider === 'none') {
    return [];
  }

  if (provider === 'auto') {
    const requested = normalizeProviderList(config.aiFallbackProviders)
      .filter(item => VALID_TEXT_PROVIDERS.includes(item));
    if (!requested.includes('pollinations')) {
      requested.push('pollinations');
    }
    return requested;
  }

  return normalizeProviderList(provider).filter(item => VALID_TEXT_PROVIDERS.includes(item));
}

function isProviderConfigured(provider) {
  if (provider === 'gemini') return Boolean(config.geminiApiKey);
  if (provider === 'groq') return Boolean(config.groqApiKey);
  if (provider === 'openrouter') return Boolean(config.openrouterApiKey);
  if (provider === 'huggingface') return Boolean(config.huggingFaceToken);
  if (provider === 'pollinations') return true;
  if (provider === 'ollama') return Boolean(config.ollamaBaseUrl && config.ollamaModel);

  return false;
}

function getConfiguredProviderOrder() {
  return getRequestedProviderOrder().filter(isProviderConfigured);
}

function isTextAiConfigured() {
  return getConfiguredProviderOrder().length > 0;
}

function getProviderLabel(provider) {
  if (provider === 'gemini') return `Gemini (${config.geminiModel})`;
  if (provider === 'groq') return `Groq (${config.groqModel})`;
  if (provider === 'openrouter') return `OpenRouter (${config.openrouterModel})`;
  if (provider === 'huggingface') return `Hugging Face (${config.huggingFaceModel})`;
  if (provider === 'pollinations') return `Pollinations (${config.pollinationsTextModel})`;
  if (provider === 'ollama') return `Ollama (${config.ollamaModel})`;
  return provider || 'none';
}

function getProviderSummary() {
  const requested = getRequestedProviderOrder();

  if (!requested.length) {
    return 'none';
  }

  if (String(config.aiProvider || '').trim().toLowerCase() === 'auto') {
    return `auto (${requested.map(getProviderLabel).join(' > ')})`;
  }

  return requested.map(getProviderLabel).join(' > ');
}

function getHistory(userId) {
  if (!userId) {
    return [];
  }

  return conversations.get(userId) || [];
}

function rememberTurn(userId, userText, assistantText) {
  if (!userId) {
    return;
  }

  const history = getHistory(userId);
  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: assistantText });
  conversations.set(userId, history.slice(-Math.max(config.aiMaxHistory, 2)));
}

function toOpenAiMessages(history, userText, systemPrompt = SYSTEM_PROMPT) {
  return [
    { role: 'system', content: systemPrompt },
    ...history.map(item => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: item.content
    })),
    { role: 'user', content: userText }
  ];
}

function toGeminiContents(history, userText) {
  return [
    ...history.map(item => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }]
    })),
    { role: 'user', parts: [{ text: userText }] }
  ];
}

function extractGeminiText(data) {
  const parts = data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  return parts.map(part => part.text || '').join('').trim();
}

async function chatWithGemini(userText, history, systemPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const res = await axios.post(url, {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: toGeminiContents(history, userText),
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 900
    }
  }, {
    headers: {
      'x-goog-api-key': config.geminiApiKey
    },
    timeout: 30000
  });

  return extractGeminiText(res.data);
}

function extractOpenAiChatText(data) {
  return String(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
}

async function chatWithGroq(userText, history, systemPrompt) {
  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: config.groqModel,
    messages: toOpenAiMessages(history, userText, systemPrompt),
    temperature: 0.4,
    max_tokens: 900
  }, {
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`
    },
    timeout: 30000
  });

  return extractOpenAiChatText(res.data);
}

async function chatWithOpenRouter(userText, history, systemPrompt) {
  const headers = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'SmartLife LINE'
  };

  if (config.publicBaseUrl) {
    headers['HTTP-Referer'] = config.publicBaseUrl;
  }

  const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model: config.openrouterModel,
    messages: toOpenAiMessages(history, userText, systemPrompt),
    temperature: 0.4,
    max_tokens: 900
  }, {
    headers,
    timeout: 45000
  });

  return extractOpenAiChatText(res.data);
}

async function chatWithHuggingFace(userText, history, systemPrompt) {
  const res = await axios.post('https://router.huggingface.co/v1/chat/completions', {
    model: config.huggingFaceModel,
    messages: toOpenAiMessages(history, userText, systemPrompt),
    temperature: 0.4,
    max_tokens: 900
  }, {
    headers: {
      Authorization: `Bearer ${config.huggingFaceToken}`
    },
    timeout: 60000
  });

  return extractOpenAiChatText(res.data);
}

async function chatWithPollinations(userText, history, systemPrompt, options = {}) {
  if (!config.pollinationsApiKey) {
    const shouldTranslateRoundTrip = options.translateThaiRoundTrip !== false && hasThaiText(userText);
    let promptUserText = userText;

    if (shouldTranslateRoundTrip) {
      try {
        promptUserText = await translateWithMyMemoryRaw(userText, 'th|en');
      } catch (err) {
        console.warn(`SmartLife Pollinations pre-translate fallback: ${getSafeErrorMessage(err)}`);
      }
    }

    const legacySystemPrompt = [
      'You are SmartLife AI in a LINE bot.',
      'Answer the user actual question in simple English.',
      'Be practical and concise.',
      'Do not talk about appointments unless the user asks about appointments or reminders.',
      'For medical, legal, financial, or disaster topics, be careful and say when official sources should be checked.'
    ].join('\n');
    const legacyPrompt = [
      legacySystemPrompt,
      '',
      ...history.slice(-6).map(item => (
        `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${item.content}`
      )),
      `User: ${promptUserText}`,
      'Assistant:'
    ].join('\n').slice(0, 3500);
    const res = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(legacyPrompt)}`, {
      params: {
        model: config.pollinationsTextModel || 'openai'
      },
      timeout: 60000,
      responseType: 'text'
    });

    if (res.data && typeof res.data === 'object' && res.data.error) {
      throw new Error(res.data.error);
    }

    const answer = String(res.data || '').trim();

    if (shouldTranslateRoundTrip && answer && !hasThaiText(answer)) {
      try {
        const translatedAnswer = await translateWithMyMemoryRaw(answer, 'en|th');
        return [
          translatedAnswer,
          '',
          'ที่มา: Pollinations free text + MyMemory translation'
        ].join('\n');
      } catch (err) {
        console.warn(`SmartLife Pollinations post-translate fallback: ${getSafeErrorMessage(err)}`);
      }
    }

    return answer;
  }

  const res = await axios.post('https://gen.pollinations.ai/v1/chat/completions', {
    model: config.pollinationsTextModel,
    messages: toOpenAiMessages(history, userText, systemPrompt),
    temperature: 0.4,
    max_tokens: 900,
    safe: 'privacy,secrets'
  }, {
    headers: {
      Authorization: `Bearer ${config.pollinationsApiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 45000
  });

  return extractOpenAiChatText(res.data);
}

async function chatWithOllama(userText, history, systemPrompt) {
  const baseUrl = String(config.ollamaBaseUrl || '').replace(/\/+$/, '');
  const res = await axios.post(`${baseUrl}/api/chat`, {
    model: config.ollamaModel,
    stream: false,
    messages: toOpenAiMessages(history, userText, systemPrompt)
  }, {
    timeout: 60000
  });

  return String(res.data && res.data.message && res.data.message.content || '').trim();
}

async function chatWithProvider(provider, userText, history, systemPrompt, options = {}) {
  if (provider === 'gemini') return chatWithGemini(userText, history, systemPrompt);
  if (provider === 'groq') return chatWithGroq(userText, history, systemPrompt);
  if (provider === 'openrouter') return chatWithOpenRouter(userText, history, systemPrompt);
  if (provider === 'huggingface') return chatWithHuggingFace(userText, history, systemPrompt);
  if (provider === 'pollinations') return chatWithPollinations(userText, history, systemPrompt, options);
  if (provider === 'ollama') return chatWithOllama(userText, history, systemPrompt);

  throw new Error(`Unsupported AI provider: ${provider}`);
}

function getSafeErrorMessage(err) {
  const status = err && err.response && err.response.status;
  const dataError = err && err.response && err.response.data && err.response.data.error;
  const dataMessage = typeof dataError === 'string'
    ? dataError
    : dataError && (dataError.message || dataError.type);
  const message = dataMessage || (err && err.code) || (err && err.message) || 'unknown error';

  return status ? `HTTP ${status} ${message}` : String(message);
}

async function generateText(userText, options = {}) {
  const providerOrder = getConfiguredProviderOrder();

  if (!providerOrder.length) {
    throw new Error('ยังไม่มีผู้ให้บริการ AI ที่พร้อมใช้งาน');
  }

  const history = options.history || [];
  const systemPrompt = options.systemPrompt || SYSTEM_PROMPT;
  const failures = [];

  for (const provider of providerOrder) {
    try {
      const text = await chatWithProvider(provider, userText, history, systemPrompt, options);

      if (text) {
        return text;
      }

      failures.push(`${provider}: empty response`);
    } catch (err) {
      const message = getSafeErrorMessage(err);
      failures.push(`${provider}: ${message}`);
      console.warn(`SmartLife AI fallback skipped ${provider}: ${message}`);
    }
  }

  throw new Error(`AI ฟรีทุกตัวตอบไม่ได้: ${failures.slice(0, 3).join(' | ')}`);
}

async function chat(userText, userId) {
  const history = getHistory(userId);
  const answer = await generateText(userText, { history });
  rememberTurn(userId, userText, answer);
  return answer;
}

function detectTranslationPair(text) {
  return hasThaiText(text) ? 'th|en' : 'en|th';
}

function normalizeTranslationKey(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function getCommonTranslation(text) {
  return COMMON_TRANSLATIONS.get(normalizeTranslationKey(text));
}

function formatTranslationResult(translatedText, sourceText) {
  return [
    translatedText,
    '',
    sourceText
  ].join('\n');
}

async function translateWithMyMemoryRaw(text, langpair = detectTranslationPair(text)) {
  const res = await axios.get('https://api.mymemory.translated.net/get', {
    params: {
      q: text,
      langpair
    },
    timeout: 15000
  });
  const translatedText = res.data && res.data.responseData && res.data.responseData.translatedText;

  if (!translatedText) {
    throw new Error('MyMemory did not return translated text');
  }

  return translatedText;
}

async function translateWithMyMemory(text) {
  const translatedText = await translateWithMyMemoryRaw(text);

  return formatTranslationResult(
    translatedText,
    'ที่มา: MyMemory public translation (ฟรี ไม่ต้องใช้ API key สำหรับ public memories)'
  );
}

async function translate(text, userId) {
  const sourceText = String(text || '').trim();

  if (!sourceText) {
    throw new Error('กรุณาใส่ข้อความที่ต้องการแปลหลังคำว่า แปล');
  }

  let answer;
  let directTranslationError;
  const commonTranslation = getCommonTranslation(sourceText);

  if (commonTranslation) {
    answer = formatTranslationResult(commonTranslation, 'ที่มา: SmartLife phrase translation');
  }

  if (!answer) {
    try {
    answer = await translateWithMyMemory(sourceText);
    } catch (err) {
      directTranslationError = getSafeErrorMessage(err);
      console.warn(`SmartLife direct translation fallback: ${directTranslationError}`);
    }
  }

  const prompt = [
    'Translate the following text naturally.',
    'If the input is Thai, translate to English.',
    'If the input is English, translate to Thai.',
    'Return only the translation unless a short note is necessary.',
    '',
    sourceText
  ].join('\n');

  if (!answer && isTextAiConfigured()) {
    try {
      answer = await generateText(prompt, {
        history: [],
        systemPrompt: 'You are a precise Thai-English translator. Keep names, dates, and numbers accurate.',
        translateThaiRoundTrip: false
      });
    } catch (err) {
      console.warn(`SmartLife translation AI fallback: ${getSafeErrorMessage(err)}`);
    }
  }

  if (!answer) {
    throw new Error(directTranslationError || 'translation provider did not return text');
  }

  rememberTurn(userId, `แปล ${sourceText}`, answer);
  return answer;
}

function getStatus() {
  const providerOrder = getRequestedProviderOrder();
  const configuredProviders = getConfiguredProviderOrder();

  return {
    provider: getProviderSummary(),
    providerOrder: providerOrder.map(getProviderLabel),
    configuredProviders: configuredProviders.map(getProviderLabel),
    textAiConfigured: isTextAiConfigured(),
    translationFallback: 'MyMemory public translation',
    historyUsers: conversations.size
  };
}

module.exports = {
  chat,
  translate,
  translateWithMyMemory,
  translateWithMyMemoryRaw,
  generateText,
  getStatus,
  normalizeProviderList,
  detectTranslationPair,
  getRequestedProviderOrder,
  getConfiguredProviderOrder,
  isTextAiConfigured
};
