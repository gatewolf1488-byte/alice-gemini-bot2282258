export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Alice DeepSeek Server is active');
  }

  const { request, session, state } = req.body || {};
  const command = request?.original_utterance || request?.command || '';

  if (session?.new || !command.trim()) {
    return res.json({
      version: '1.0',
      response: {
        text: 'Привет! Я умная Алиса на базе DeepSeek. О чём поговорим?',
        end_session: false,
      },
      session_state: { history: [] },
    });
  }

  let history = state?.session?.history || [];

  try {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const serperKey = process.env.SERPER_API_KEY;

    if (!deepseekKey) {
      return res.json({
        version: '1.0',
        response: {
          text: 'Ошибка: API-ключ DEEPSEEK_API_KEY не добавлен в Vercel.',
          end_session: false,
        },
      });
    }

    // Поиск свежих данных через Serper (если ключ добавлен)
    let searchContext = '';
    if (serperKey) {
      try {
        const searchRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': serperKey.trim(),
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

    // Формируем историю сообщений для DeepSeek (OpenAI format)
    const messages = [
      { role: 'system', content: systemInstruction },
      ...history,
      { role: 'user', content: command + searchContext },
    ];

    // Запрос к DeepSeek API
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepseekKey.trim()}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.7,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error('DeepSeek Error:', data.error);
      return res.json({
        version: '1.0',
        response: {
          text: `Ошибка DeepSeek: ${data.error.message || 'Проверьте API ключ'}`,
          end_session: false,
        },
      });
    }

    let replyText =
      data?.choices?.[0]?.message?.content ||
      'Не удалось получить ответ от DeepSeek.';

    // Убираем маркдаун для озвучки
    replyText = replyText.replace(/[*#_`]/g, '').trim();

    // Сохраняем историю (последние 6 сообщений)
    history.push({ role: 'user', content: command });
    history.push({ role: 'assistant', content: replyText });
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
        text: 'Произошла ошибка сервера. Попробуйте еще раз.',
        end_session: false,
      },
    });
  }
}
