export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Alice Gemini Server is active');
  }

  const { request, session, state } = req.body || {};
  const command = request?.original_utterance || request?.command || '';

  // При старте навыка или пустом запросе
  if (session?.new || !command.trim()) {
    return res.json({
      version: '1.0',
      response: {
        text: 'Привет! Я умная Алиса на базе Gemini. О чём поговорим?',
        end_session: false,
      },
      session_state: { history: [] },
    });
  }

  let history = state?.session?.history || [];

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const serperKey = process.env.SERPER_API_KEY;

    // Поиск актуальной информации через Serper
    let searchContext = '';
    if (serperKey) {
      try {
        const searchRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': serperKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: command, hl: 'ru', gl: 'ru' }),
        });
        const searchData = await searchRes.json();
        if (searchData.organic && searchData.organic.length > 0) {
          const snippets = searchData.organic
            .slice(0, 3)
            .map((s) => `${s.title}:${s.snippet}`)
            .join('\n');
          searchContext = `\n[Свежие данные из поиска:\n${snippets}]`;
        }
      } catch (e) {
        console.error('Serper search error:', e);
      }
    }

    const systemInstruction =
      'Ты — голосовой ассистент Алиса. Отвечай кратко, емко и понятным языком. НЕ используй никакой markdown-разметки (без звездочек, решёток, жирного шрифта, списков), так как ответ будет зачитываться голосом. Ограничивай ответ 2-3 предложениями.';

    const contents = [
      ...history,
      {
        role: 'user',
        parts: [{ text: command + searchContext }],
      },
    ];

    // Запрос к Gemini
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: contents,
      }),
    });

    const geminiData = await response.json();
    let replyText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Не удалось получить ответ от Gemini.';

    // Очистка от маркдауна для зачитывания голосом
    replyText = replyText.replace(/[*#_`]/g, '').trim();

    // Сохранение контекста (до 6 сообщений)
    history.push({ role: 'user', parts: [{ text: command }] });
    history.push({ role: 'model', parts: [{ text: replyText }] });
    if (history.length > 6) {
      history = history.slice(history.length - 6);
    }

    return res.json({
      version: '1.0',
      response: {
        text: replyText,
        end_session: false,
      },
      session_state: {
        history: history,
      },
    });
  } catch (error) {
    console.error('Error handling request:', error);
    return res.json({
      version: '1.0',
      response: {
        text: 'Произошла ошибка при обработке запроса. Попробуйте еще раз.',
        end_session: false,
      },
    });
  }
}
