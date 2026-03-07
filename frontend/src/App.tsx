import { useState, useEffect, useCallback } from 'react';
import {
  getSessions,
  createSession,
  getThread,
  getPreferences,
  getInitialProperties,
  searchByFilters,
  sendChat,
  type Session,
  type ThreadMessage,
  type PropertySummary,
  type Preferences,
} from './api/client';
import { ChatPanel } from './components/ChatPanel';
import { PropertyList } from './components/PropertyList';
import { FilterBar, type FilterSearchParams } from './components/FilterBar';
import { PipelinePane } from './components/PipelinePane';
import { Map } from './components/Map';
import { DemoWalkthrough } from './components/DemoWalkthrough';
import './App.css';

const DEMO_USER_ID = 'demo-buyer';

function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [top10, setTop10] = useState<PropertySummary[]>([]);
  const [filterSearchResults, setFilterSearchResults] = useState<PropertySummary[]>([]);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [pipelineSteps, setPipelineSteps] = useState<string[]>([]);
  const [aggregationPipeline, setAggregationPipeline] = useState<object[]>([]);
  const [marketEstimateQuery, setMarketEstimateQuery] = useState<object | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoWalkthroughOpen, setDemoWalkthroughOpen] = useState(false);

  const loadSessions = useCallback(async (uid: string) => {
    try {
      const list = await getSessions(uid);
      setSessions(list);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadThread = useCallback(async (sid: string) => {
    if (!sid) {
      setMessages([]);
      return;
    }
    try {
      const msgs = await getThread(sid);
      setMessages(Array.isArray(msgs) ? msgs : []);
    } catch (e) {
      console.error(e);
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    getPreferences(userId).then(setPrefs).catch(console.error);
    loadSessions(userId);
  }, [userId, loadSessions]);

  useEffect(() => {
    if (!sessionId) return;
    loadThread(sessionId);
  }, [sessionId, loadThread]);

  const handleLogin = async () => {
    setError(null);
    try {
      const session = await createSession(DEMO_USER_ID);
      const prefs = await getPreferences(DEMO_USER_ID);
      const initial = await getInitialProperties(DEMO_USER_ID);
      setUserId(DEMO_USER_ID);
      setSessionId(session.sessionId);
      setSessions([session]);
      setPrefs(prefs);
      setTop10(initial);
      setMessages([]);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Could not connect. Is the backend running on port 4000?');
    }
  };

  const handleNewSession = async () => {
    if (!userId) return;
    setError(null);
    try {
      const session = await createSession(userId);
      setSessionId(session.sessionId);
      setMessages([]);
      setTop10([]);
      setFilterSearchResults([]);
      setPipelineSteps([]);
      setAggregationPipeline([]);
      setMarketEstimateQuery(null);
      loadSessions(userId);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to start new conversation');
    }
  };

  const handleSelectSession = (sid: string) => {
    setSessionId(sid);
    setTop10([]);
    setFilterSearchResults([]);
    setPipelineSteps([]);
    setAggregationPipeline([]);
    setMarketEstimateQuery(null);
    if (!sid) setMessages([]);
  };

  const handleFilterSearch = async (params: FilterSearchParams) => {
    setError(null);
    setSearchLoading(true);
    try {
      const res = await searchByFilters(params);
      setFilterSearchResults(res.properties || []);
      setPipelineSteps(res.pipelineSteps || []);
      setAggregationPipeline(res.aggregationPipeline || []);
      setMarketEstimateQuery(null);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Search failed. Is the backend running?');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!sessionId || !userId) return;
    setError(null);
    setLoading(true);
    try {
      const res = await sendChat(sessionId, userId, message);
      setMessages((prev) => [
        ...prev,
        { type: 'human', content: message, timestamp: new Date().toISOString() },
        {
          type: 'ai',
          content: res.reply,
          toolCalls: res.toolCallsLog?.length ? res.toolCallsLog : undefined,
          timestamp: new Date().toISOString(),
        },
      ]);
      setTop10(res.top10 || []);
      if (res.pipelineSteps?.length) setPipelineSteps(res.pipelineSteps);
      setAggregationPipeline(Array.isArray(res.aggregationPipeline) ? res.aggregationPipeline : []);
      setMarketEstimateQuery(res.marketEstimateQuery ?? null);
      setFilterSearchResults([]);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Message failed. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  if (!userId) {
    return (
      <div className="app login-screen">
        <h1>Agentic Property Search</h1>
        <p>Demo: log in as buyer to start.</p>
        {error && <p className="app-error">{error}</p>}
        <button type="button" onClick={handleLogin}>
          Login as buyer
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      {error && (
        <div className="app-error-banner" role="alert">
          {error}
          <button type="button" className="app-error-dismiss" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      <header className="app-header">
        <h1>Property Search Assistant</h1>
        <FilterBar
          userId={userId}
          prefs={prefs}
          onPrefsSaved={(p) => {
            setPrefs(p);
            setError(null);
            getInitialProperties(userId).then(setTop10);
          }}
          onSaveError={(msg) => setError(msg)}
          onSearch={handleFilterSearch}
          searchLoading={searchLoading}
        />
        <div className="header-actions">
          <button type="button" onClick={() => setDemoWalkthroughOpen(true)} className="header-btn-demo">
            Demo guide
          </button>
          <select
            value={sessionId || ''}
            onChange={(e) => handleSelectSession(e.target.value)}
            title="Conversation"
          >
            <option value="">Select conversation</option>
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {new Date(s.updatedAt).toLocaleString()}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleNewSession}>
            New conversation
          </button>
        </div>
      </header>
      <DemoWalkthrough open={demoWalkthroughOpen} onClose={() => setDemoWalkthroughOpen(false)} />

      <main className="app-main">
        <section className="chat-section">
          <ChatPanel messages={messages} onSend={handleSendMessage} loading={loading} hasInitialResults={top10.length > 0} />
        </section>
        <section className="results-section">
          {(pipelineSteps.length > 0 || aggregationPipeline.length > 0 || marketEstimateQuery) && (
            <PipelinePane
              steps={pipelineSteps}
              title="Search pipeline"
              aggregationPipeline={aggregationPipeline.length > 0 ? aggregationPipeline : undefined}
              marketEstimateQuery={marketEstimateQuery ?? undefined}
            />
          )}
          {top10.length > 0 && pipelineSteps.length === 0 && (
            <p className="search-semantics">Search pipeline: Geo search → Vector search → Reranker</p>
          )}
          <PropertyList
            properties={top10}
            title="Recommendations"
            emptyMessage="Recommendations will appear here after you ask the agent."
            selectedId={selectedPropertyId ?? undefined}
            onSelect={(p) => setSelectedPropertyId(p?._id ?? null)}
          />
          {filterSearchResults.length > 0 && (
            <div className="search-results-block">
              <PropertyList
                properties={filterSearchResults}
                title={`Search results (${filterSearchResults.length})`}
                emptyMessage="No properties match your filters."
                selectedId={selectedPropertyId ?? undefined}
                onSelect={(p) => setSelectedPropertyId(p?._id ?? null)}
              />
            </div>
          )}
          <div className="map-section">
            <Map
              properties={filterSearchResults.length > 0 ? filterSearchResults : top10}
              selectedId={selectedPropertyId ?? undefined}
              onSelect={(p) => setSelectedPropertyId(p?._id ?? null)}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
