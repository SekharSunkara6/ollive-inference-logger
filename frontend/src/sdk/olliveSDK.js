import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const INGESTION_URL = import.meta.env.VITE_INGESTION_URL || 'http://localhost:8000';

const PROVIDERS = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama3-8b-8192',
    headerKey: 'Authorization',
    headerFormat: (key) => `Bearer ${key}`,
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-1.5-flash',
    headerKey: 'Authorization',
    headerFormat: (key) => `Bearer ${key}`,
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'meta-llama/llama-3-8b-instruct:free',
    headerKey: 'Authorization',
    headerFormat: (key) => `Bearer ${key}`,
  },
};

class OlliveSDK {
  constructor(config = {}) {
    this.providerName = config.provider || 'groq';
    this.providerConfig = PROVIDERS[this.providerName];
    this.model = config.model || this.providerConfig.defaultModel;
    this.apiKey = config.apiKey;
  }

  async chat(messages, conversationId, onChunk) {
    const messageId = uuidv4();
    const startTime = Date.now();
    let status = 'success';
    let errorMessage = null;
    let responseText = '';
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Filter and clean messages for Groq
    const cleanMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .filter(m => m.content && m.content.trim() !== '')
      .map(m => ({ role: m.role, content: m.content }));

    console.log('[OlliveSDK] Sending to Groq:', JSON.stringify(cleanMessages, null, 2));
    console.log('[OlliveSDK] API Key present:', !!this.apiKey, this.apiKey?.slice(0,8));

    try {
      const response = await fetch(this.providerConfig.baseURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [this.providerConfig.headerKey]: this.providerConfig.headerFormat(this.apiKey),
        },
        body: JSON.stringify({
          model: this.model,
          messages: cleanMessages,
          max_tokens: 1024,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[OlliveSDK] Groq error response:', errText);
        throw new Error(`API ${response.status}: ${errText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.replace('data: ', ''));
            const text = data.choices?.[0]?.delta?.content || '';
            if (text) { responseText += text; onChunk?.(text); }
            if (data.usage) {
              usage.prompt_tokens = data.usage.prompt_tokens || 0;
              usage.completion_tokens = data.usage.completion_tokens || 0;
              usage.total_tokens = data.usage.total_tokens || 0;
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      status = 'error';
      errorMessage = err.message;
      responseText = `Error: ${err.message}`;
    }

    const latency = Date.now() - startTime;

    await this._sendLog({
      conversation_id: conversationId,
      message_id: messageId,
      provider: this.providerName,
      model: this.model,
      role: 'assistant',
      content: responseText,
      latency_ms: latency,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      status,
      error_message: errorMessage,
      timestamp: new Date().toISOString(),
      metadata: { streaming: true },
    });

    return { text: responseText, messageId, usage, latency };
  }

  async logUserMessage(content, conversationId) {
    await this._sendLog({
      conversation_id: conversationId,
      message_id: uuidv4(),
      provider: this.providerName,
      model: this.model,
      role: 'user',
      content,
      latency_ms: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      status: 'success',
      timestamp: new Date().toISOString(),
    });
  }

  async _sendLog(payload) {
    try {
      await axios.post(`${INGESTION_URL}/ingest`, payload, { timeout: 5000 });
    } catch (e) {
      console.warn('[OlliveSDK] Log failed silently:', e.message);
    }
  }
}

export default OlliveSDK;