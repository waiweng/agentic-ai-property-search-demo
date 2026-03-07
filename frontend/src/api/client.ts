const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export interface Session {
  userId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadMessage {
  type: 'human' | 'ai' | 'system';
  content: string;
  toolCalls?: string[];
  timestamp: string;
}

export interface PropertySummary {
  _id: string;
  title: string;
  description: string;
  suburb: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  parking: number;
  propertyType: string;
  location?: { type: string; coordinates: number[] };
}

export interface Preferences {
  bedrooms: number;
  bathrooms: number;
  parking: number;
  suburbPreference: string;
  referencePoint: string;
  defaultRadiusKm: number;
  priceMin?: number;
  priceMax?: number;
}

export interface ChatResponse {
  reply: string;
  top10: PropertySummary[];
  toolCallsLog: string[];
  pipelineSteps?: string[];
  aggregationPipeline?: object[];
  marketEstimateQuery?: object;
  sessionId: string;
}

export interface SearchByFiltersResponse {
  properties: PropertySummary[];
  toolCallsLog: string[];
  pipelineSteps: string[];
  aggregationPipeline?: object[];
}

export async function getSessions(userId: string): Promise<Session[]> {
  const res = await fetch(`${API_URL}/api/sessions?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.sessions || [];
}

export async function createSession(userId: string): Promise<Session> {
  const res = await fetch(`${API_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getThread(sessionId: string): Promise<ThreadMessage[]> {
  const res = await fetch(`${API_URL}/api/sessions/thread?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.messages || [];
}

export async function getPreferences(userId?: string): Promise<Preferences> {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  const res = await fetch(`${API_URL}/api/preferences${q}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function savePreferences(userId: string, prefs: Partial<Preferences>): Promise<Preferences> {
  const res = await fetch(`${API_URL}/api/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...prefs }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getInitialProperties(userId: string): Promise<PropertySummary[]> {
  const res = await fetch(`${API_URL}/api/preferences/initial-properties?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.properties || [];
}

export async function searchByFilters(params: {
  bedrooms: number;
  bathrooms: number;
  parking: number;
  location: string;
  priceMin?: number;
  priceMax?: number;
}): Promise<SearchByFiltersResponse> {
  const res = await fetch(`${API_URL}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface LocationSuggestion {
  name: string;
  type?: string;
}

export async function getLocationSuggestions(query: string): Promise<LocationSuggestion[]> {
  if (!query.trim()) return [];
  const res = await fetch(
    `${API_URL}/api/places/autocomplete?q=${encodeURIComponent(query.trim())}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.suggestions ?? [];
}

export async function sendChat(sessionId: string, userId: string, message: string): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, userId, message }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
