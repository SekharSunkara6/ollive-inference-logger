import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import OlliveSDK from './sdk/olliveSDK';
import './App.css';

const API = import.meta.env.VITE_INGESTION_URL || 'http://127.0.0.1:8000';

const sdk = new OlliveSDK({
  provider: 'groq',
  model: 'llama-3.3-70b-versatile',
  apiKey: import.meta.env.VITE_GROQ_KEY,
});

export default function App() {
  const [view, setView] = useState('chat');
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const bottomRef = useRef();
  const sendingRef = useRef(false);

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamText]);
  useEffect(() => {
    if (view === 'dashboard') {
      axios.get(`${API}/metrics/summary`).then(r => setMetrics(r.data));
      axios.get(`${API}/metrics/timeseries`).then(r => setTimeseries(r.data));
    }
  }, [view]);

  const loadConversations = async () => {
    try {
      const res = await axios.get(`${API}/conversations`);
      setConversations(res.data);
    } catch (e) { console.error('loadConversations error:', e); }
  };

  const newConversation = async () => {
    try {
      const res = await axios.post(`${API}/conversations`, {
        provider: 'groq', model: 'llama-3.3-70b-versatile', title: 'New Chat'
      });
      await loadConversations();
      setActiveConvId(res.data.id);
      setMessages([]);
      setView('chat');
    } catch (e) { console.error('newConversation error:', e); }
  };

  const loadConversation = async (id) => {
    setActiveConvId(id);
    try {
      const res = await axios.get(`${API}/conversations/${id}/messages`);
      setMessages(res.data.map(m => ({ role: m.role, content: m.content })));
    } catch (e) { console.error('loadConversation error:', e); }
  };

  const cancelConversation = async (id, e) => {
    e.stopPropagation();
    await axios.delete(`${API}/conversations/${id}`);
    if (id === activeConvId) { setActiveConvId(null); setMessages([]); }
    await loadConversations();
  };

  const sendMessage = async () => {
    if (!input.trim() || streaming || sendingRef.current) return;
    sendingRef.current = true;
    let convId = activeConvId;
    try {
      if (!convId) {
        const res = await axios.post(`${API}/conversations`, {
          provider: 'groq', model: 'llama-3.3-70b-versatile', title: input.slice(0, 40),
        });
        convId = res.data.id;
        setActiveConvId(convId);
        await loadConversations();
      }
      const userMsg = { role: 'user', content: input };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setInput('');
      setStreaming(true);
      setStreamText('');
      await sdk.logUserMessage(input, convId);
      let accumulated = '';
      await sdk.chat(
        newMessages.map(m => ({ role: m.role, content: m.content })),
        convId,
        (chunk) => { accumulated += chunk; setStreamText(accumulated); }
      );
      setMessages([...newMessages, { role: 'assistant', content: accumulated }]);
      setStreamText('');
      await loadConversations();
    } catch (e) {
      console.error('sendMessage error:', e);
    } finally {
      setStreaming(false);
      sendingRef.current = false;
    }
  };

  const activeConv = conversations.find(c => c.id === activeConvId);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">⬡ Ollive</div>
          <div className="logo-sub">Inference Logger</div>
        </div>
        <button className="new-chat-btn" onClick={newConversation}>+ New Chat</button>
        <nav className="nav-tabs">
          <button className={view==='chat'?'active':''} onClick={()=>setView('chat')}>💬 Chats</button>
          <button className={view==='dashboard'?'active':''} onClick={()=>setView('dashboard')}>📊 Dashboard</button>
        </nav>
        <div className="conv-list">
          {conversations.map(c => (
            <div key={c.id}
              className={`conv-item ${c.id === activeConvId ? 'active' : ''} ${!c.is_active ? 'cancelled' : ''}`}
              onClick={() => { setView('chat'); loadConversation(c.id); }}>
              <span className="conv-title">{c.title}</span>
              <div className="conv-meta">
                <span>{c.model?.split('-')[0] || c.model}</span>
                {c.is_active ? (
                  <button className="cancel-btn" onClick={(e) => cancelConversation(c.id, e)}>✕</button>
                ) : <span className="badge-cancelled">cancelled</span>}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        {view === 'chat' ? (
          <>
            <div className="chat-header">
              <span>{activeConv ? activeConv.title : 'Select or start a conversation'}</span>
              {activeConv && <span className="model-badge">{activeConv.model}</span>}
            </div>
            <div className="messages">
              {messages.length === 0 && !streaming && (
                <div className="empty-state">
                  <div className="empty-icon">⬡</div>
                  <div>Start a conversation</div>
                  <div className="empty-sub">All inferences are logged & observable</div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="msg-role">{m.role === 'user' ? 'You' : '⬡ Ollive'}</div>
                  <div className="msg-content">{m.content}</div>
                </div>
              ))}
              {streaming && streamText && (
                <div className="msg assistant">
                  <div className="msg-role">⬡ Ollive</div>
                  <div className="msg-content">{streamText}<span className="cursor">▋</span></div>
                </div>
              )}
              {streaming && !streamText && (
                <div className="msg assistant">
                  <div className="msg-role">⬡ Ollive</div>
                  <div className="typing"><span/><span/><span/></div>
                </div>
              )}
              <div ref={bottomRef}/>
            </div>
            <div className="input-bar">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
                placeholder="Message Ollive... (Enter to send)"
                rows={1}
                disabled={streaming}
              />
              <button onClick={sendMessage} disabled={streaming || !input.trim()}>
                {streaming ? '⟳' : '↑'}
              </button>
            </div>
          </>
        ) : (
          <div className="dashboard">
            <h2 className="dash-title">Inference Dashboard</h2>
            {metrics && (
              <div className="metric-cards">
                <div className="card"><div className="card-val">{metrics.total_requests}</div><div className="card-label">Total Requests</div></div>
                <div className="card"><div className="card-val">{metrics.avg_latency_ms}ms</div><div className="card-label">Avg Latency</div></div>
                <div className="card"><div className="card-val">{metrics.error_rate}%</div><div className="card-label">Error Rate</div></div>
                <div className="card"><div className="card-val">{metrics.total_tokens?.toLocaleString()}</div><div className="card-label">Total Tokens</div></div>
              </div>
            )}
            <div className="chart-grid">
              <div className="chart-box">
                <h3>Latency over time (ms)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={timeseries}>
                    <XAxis dataKey="timestamp" hide/>
                    <YAxis/>
                    <Tooltip/>
                    <Line type="monotone" dataKey="latency_ms" stroke="#00ff9d" dot={false} strokeWidth={2}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-box">
                <h3>Token usage per request</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={timeseries}>
                    <XAxis dataKey="timestamp" hide/>
                    <YAxis/>
                    <Tooltip/>
                    <Bar dataKey="total_tokens" fill="#00c8ff" radius={[3,3,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}