import {
  StateGraph,
  Annotation,
  messagesStateReducer,
  END,
  START,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import {
  HumanMessage,
  AIMessage,
  BaseMessage,
  ToolMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { getVertexModel } from '../services/vertex';
import { agentTools } from './tools';
import { getMarketEstimate } from '../services/market';
import type { PropertySummary } from '../services/search';
import { getSupportedSuburbs, getSupportedPlaceNames, suburbListToRegex } from '../services/suburbs';
import { MongoDBCheckpointSaver } from '../lib/mongo-checkpointer';

const SYSTEM_PROMPT = `You are a proactive, polite Property Search Assistant. You only help with property search and price guides. You have exactly two tools: get_market_estimate and property_search. If the user's question cannot be answered by either tool, do NOT call any tool—reply with a short, honest "I don't know" style message and say what you can do instead.

When a system message below provides "Current saved preferences", use those (beds, baths, parking, suburb, radius) for property search when the user asks to see properties or has not specified otherwise.

Bedrooms for property search (strict):
- If the user asks to find/show/list properties but does NOT specify how many bedrooms, do NOT call any tool (no property_search, no get_poi_coordinates). Reply ONLY with a short question: "How many bedrooms are you looking for? (e.g. 1, 2, or 3)." Do not call any tools until they answer.
- When the user replies with ONLY a bedroom number or "X bedroom(s)" (e.g. "2", "2 bedroom", "two bedroom", "3 bed"), they are answering your question. You MUST then call property_search with bedrooms=X. Use the location (place_name) and query (query_text) from the previous user message in the conversation (e.g. "quiet, renovated, natural light" and "James Ruse Public School"). Pass bedrooms as that number (e.g. bedrooms: 2).
- If the user specifies bedrooms in the same message as the request (e.g. "find me a 2 bed apartment near James Ruse"), pass that number to property_search.

Location and "near a school":
- "Near [place]", "close to [place]", "around [place]" means the user wants properties in that area. The place can be a suburb, station, village, or a school name (e.g. "James Ruse Public School"). Use that as place_name—it is a location for property search, NOT a question about schools. Always call property_search with that place_name and reply with the search results (how many properties found), not a message saying you don't have school information.

Tool choice (only these two—if the question doesn't fit, call no tools):

- PROPERTY SEARCH (user wants to SEE listings): Use property_search when the user asks to find, show, or list properties—e.g. "find me X", "show me X", "list of property", "can you find", "nicely renovated ... near [place]", "apartment near [place/station/school]", "2 bedroom apartment near Epping Station", "quiet apartment near Carlingford", "properties close to James Ruse Public School". Always use property_search with query_text (describe what they want, e.g. "renovated, natural light"), place_name (the place/station/suburb/school name they said), and bedrooms when known. Do NOT use get_market_estimate for these—get_market_estimate is only for price numbers.

- PRICE / MARKET (user wants a PRICE NUMBER): Use get_market_estimate ONLY when the user explicitly asks for price, e.g. "price guide for [SUBURB]", "how much in Parramatta", "average price for 2 bed in Epping", "what would be a price". Use the suburb the user said. Do NOT use get_market_estimate for "find me ... near X" or "list of property near X".

- CONVERSATION: "What have I asked", "summarise our conversation" → do NOT call any tools. Answer from the chat history.

Out-of-scope (do NOT call any tool):
- "Which suburb is cheaper?", "other cheap areas?", "compare suburbs", "recommend a suburb" → Say you can only give a price guide when they name one suburb, and find properties near a place; you cannot compare suburbs.
- Questions ABOUT schools (e.g. "is there a good school", "what schools are there") → Say you don't have information about schools; offer to find properties near a place they name or give a price guide. If they ask for properties NEAR a school (e.g. "apartments near James Ruse Public School"), that is a property search—use the school name as place_name and call property_search.

Reply in your own words using the tool result (your final message must be grounded in the tool output only):
- get_market_estimate: mention the suburb, average price (from the tool), and growth if available. Use only suburb and numbers from the tool.
- property_search: briefly say how many properties you found; offer to help further. Use only the count and result from the tool.
- If a tool returns no data, say clearly that you don't have enough data. Never fabricate prices or suburb names.

Rules:
- Only property-related questions. Off-topic: "I'm designed to help with property search only."
- Be concise and helpful.`;

/** State: messages (reducer) + finalReply (set only in respond node to avoid hallucination). */
const AgentStateAnnotation = Annotation.Root({
  messages: Annotation({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  finalReply: Annotation<string>(),
});

type AgentState = typeof AgentStateAnnotation.State;

// Compiled graph type is complex; avoid deep instantiation by using inference where it's used.
let compiledGraph: { invoke: (input: { messages: BaseMessage[] }, config?: { configurable?: Record<string, unknown> }) => Promise<AgentState & { finalReply?: string }> } | null = null;
let checkpointer: MongoDBCheckpointSaver | null = null;

function getCheckpointer(): MongoDBCheckpointSaver {
  if (!checkpointer) checkpointer = new MongoDBCheckpointSaver();
  return checkpointer;
}

function buildGraph() {
  // LangGraph ToolNode has very deep generics; cast to avoid TS2589 at compile time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolNode = new ToolNode(agentTools as any);

  const callModel = async (state: AgentState, config: { configurable?: Record<string, unknown> }) => {
    const prefs = config.configurable?.preferences as UserPreferences | undefined;
    const memoryContext = config.configurable?.memoryContext as string | undefined;
    const parts = [SYSTEM_PROMPT];
    if (memoryContext) parts.push(memoryContext);
    if (prefs) parts.push(formatPreferencesContext(prefs));
    const systemMessage = new SystemMessage(parts.join('\n\n'));
    // Gemini/Vertex allow only one system message and it must be first; drop any from state (e.g. from checkpoint or deserialized).
    const withoutSystem = state.messages.filter((m) => {
      if (m instanceof SystemMessage) return false;
      const type = (m as BaseMessage)._getType?.();
      return type !== 'system';
    });
    const messagesToSend = [systemMessage, ...withoutSystem];
    const llm = await getVertexModel();
    const withTools = llm.bindTools(agentTools);
    const response = (await withTools.invoke(messagesToSend)) as AIMessage;
    return { messages: [response] };
  };

  const shouldContinue = (state: AgentState): 'tools' | 'respond' => {
    const messages = state.messages;
    const last = messages[messages.length - 1];
    if (last && typeof last === 'object' && 'tool_calls' in last) {
      const ai = last as AIMessage;
      if (ai.tool_calls?.length) return 'tools';
    }
    return 'respond';
  };

  const respondNode = async (state: AgentState): Promise<{ finalReply: string }> => {
    try {
      const userMessage = getLastHumanContent(state.messages);
      const reply = await buildFinalReply(state.messages, userMessage);
      return { finalReply: reply ?? '' };
    } catch (err) {
      console.error('Respond node error:', err);
      return { finalReply: "I ran into an issue generating that response. Please try again." };
    }
  };

  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addNode('respond', respondNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      tools: 'tools',
      respond: 'respond',
    })
    .addEdge('tools', 'agent')
    .addEdge('respond', END);

  return workflow.compile({
    checkpointer: getCheckpointer(),
  });
}

async function getAgent() {
  if (!compiledGraph) compiledGraph = buildGraph();
  return compiledGraph;
}

export interface AgentResult {
  reply: string;
  toolCallsLog: string[];
  top10: PropertySummary[];
  pipelineSteps?: string[];
  aggregationPipeline?: object[];
  marketEstimateQuery?: object;
}

export interface UserPreferences {
  bedrooms: number;
  bathrooms: number;
  parking: number;
  suburbPreference: string;
  defaultRadiusKm: number;
}

function formatPreferencesContext(prefs: UserPreferences): string {
  return `Current saved preferences: ${prefs.bedrooms} bed, ${prefs.bathrooms} bath, ${prefs.parking} parking, near ${prefs.suburbPreference} (${prefs.defaultRadiusKm} km). Use these when the user asks for recommendations or to see properties matching their preferences.`;
}

function getLastHumanContent(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m instanceof HumanMessage && typeof m.content === 'string') return m.content;
  }
  return '';
}

function extractToolCallsAndResults(messages: BaseMessage[]): {
  toolCallsLog: string[];
  top10: PropertySummary[];
  aggregationPipeline: object[] | null;
  lastToolWasPropertySearch: boolean;
  lastToolWasMarketEstimate: boolean;
  propertySearchRanThisTurn: boolean;
  marketEstimateContent: string | null;
  marketEstimateQuery: object | null;
} {
  const toolCallsLog: string[] = [];
  let top10: PropertySummary[] = [];
  let aggregationPipeline: object[] | null = null;
  let lastToolWasPropertySearch = false;
  let lastToolWasMarketEstimate = false;
  let propertySearchRanThisTurn = false;
  let marketEstimateContent: string | null = null;
  let marketEstimateQuery: object | null = null;
  let lastMarketCallId: string | null = null;
  const marketResultsByCallId = new Map<string, string>();
  for (const msg of messages) {
    if (msg instanceof HumanMessage) {
      toolCallsLog.length = 0;
      top10 = [];
      aggregationPipeline = null;
      lastToolWasPropertySearch = false;
      lastToolWasMarketEstimate = false;
      propertySearchRanThisTurn = false;
      marketEstimateContent = null;
      marketEstimateQuery = null;
      lastMarketCallId = null;
      marketResultsByCallId.clear();
    }
    if (msg instanceof AIMessage && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        if (tc.name) toolCallsLog.push(tc.name);
        if (tc.name === 'get_market_estimate' && tc.args) {
          if (tc.id) lastMarketCallId = tc.id;
          if (typeof tc.args === 'object') marketEstimateQuery = tc.args as object;
          else if (typeof tc.args === 'string') {
            try {
              const parsed = JSON.parse(tc.args);
              if (parsed && typeof parsed === 'object') marketEstimateQuery = parsed;
            } catch (_) {}
          }
        }
      }
    }
    if (msg instanceof ToolMessage) {
      if (msg.name === 'property_search') {
        lastToolWasPropertySearch = true;
        lastToolWasMarketEstimate = false;
        propertySearchRanThisTurn = true;
        try {
          const parsed = JSON.parse(
            typeof msg.content === 'string' ? msg.content : String(msg.content)
          );
          if (parsed.properties?.length) top10 = parsed.properties;
          if (parsed.toolCallsLog?.length) toolCallsLog.push(...parsed.toolCallsLog);
          if (Array.isArray(parsed.aggregationPipeline))
            aggregationPipeline = parsed.aggregationPipeline;
        } catch (_) {}
      } else if (msg.name === 'get_market_estimate') {
        lastToolWasPropertySearch = false;
        lastToolWasMarketEstimate = true;
        marketEstimateContent =
          typeof msg.content === 'string' ? msg.content : String(msg.content);
        if (msg.tool_call_id) marketResultsByCallId.set(msg.tool_call_id, marketEstimateContent);
      } else {
        lastToolWasPropertySearch = false;
        lastToolWasMarketEstimate = false;
        marketEstimateContent = null;
        aggregationPipeline = null;
      }
    }
  }
  if (
    lastMarketCallId &&
    marketEstimateQuery &&
    marketResultsByCallId.has(lastMarketCallId)
  ) {
    marketEstimateContent = marketResultsByCallId.get(lastMarketCallId) ?? marketEstimateContent;
  }
  return {
    toolCallsLog,
    top10,
    aggregationPipeline,
    lastToolWasPropertySearch,
    lastToolWasMarketEstimate,
    propertySearchRanThisTurn,
    marketEstimateContent,
    marketEstimateQuery,
  };
}

const isConversationIntent = (text: string): boolean => {
  const t = text.toLowerCase();
  return (
    /what (have|did|do) i (ask|asked)|what have (you|i) (been )?asked|summarise our conversation|summary of (our )?conversation|recap|what (did|have) we (discussed|talked)/i.test(
      t
    ) ||
    /what (do|did) you (know|remember) (about )?(what )?i (asked|said|told)/i.test(t) ||
    /what (have|did) i (ask|asked) (you )?(so far|before)/i.test(t)
  );
};
/** Price-guide intent: generic price phrases OR (mentions a supported suburb + price-related). Uses DB-driven suburb list. */
function isPriceGuideIntent(text: string, supportedSuburbs: string[]): boolean {
  const t = text.toLowerCase();
  const generic =
    /price\s*guide|what would be a price|how much (would|should|is)|what (should|would) i offer|market price|average price|price (for|in|of)/i.test(t);
  const suburbRegex = suburbListToRegex(supportedSuburbs);
  const withSuburb =
    suburbRegex &&
    suburbRegex.test(t) &&
    /(price|guide|how much|offer)/i.test(t);
  const bedWithSuburb =
    /(two|2|three|3)\s*bed(room)?.*(price|guide)/i.test(t) &&
    suburbRegex &&
    suburbRegex.test(t);
  return !!(generic || withSuburb || bedWithSuburb);
}

/** User is asking to compare suburbs, find cheaper areas, or recommend suburbs—we don't have that data; should not call tools. */
const isOutOfScopeOrComparison = (text: string): boolean => {
  const t = text.toLowerCase();
  return (
    /cheaper suburb|cheapest suburb|which suburb (is )?cheaper|other (area|suburb)s? (which are )?cheaper|any other (area|place|suburb).*cheaper|compare suburb|recommend a suburb|best suburb (for|in)|cheaper (area|place)s? (in )?(sydney|nsw)|what('s| is) the cheaper/i.test(t) ||
    /(sydney|nsw).*cheaper|cheaper.*(sydney|nsw)/i.test(t)
  );
};

/** User wants to see/find/list properties (listings), not a price number. */
const isPropertySearchIntent = (text: string): boolean => {
  const t = text.toLowerCase();
  return (
    /\b(find|show|get)\s+(me\s+)?(a\s+)?(list\s+of\s+)?propert/i.test(t) ||
    /\b(find|show|get)\s+me\s+.*\b(apartment|property|house|bed\s*room|bed)\b/i.test(t) ||
    /\bcan you find\s+(me\s+)?(a\s+)?(list\s+of\s+)?/i.test(t) ||
    /\b(list|listing)s?\s+(of\s+)?(.+\s+)?propert/i.test(t) ||
    /\bdo you have\s+(a\s+)?list\s+(of\s+)?/i.test(t) ||
    /\b(renovated|quiet|nicely|natural\s+light)\s+.*\s+(near|close\s+to|around)\s+/i.test(t) ||
    /\b(apartment|property|house)\s+.*\s+(near|close\s+to|around)\s+/i.test(t) ||
    /\b(near|close\s+to|around)\s+[^?.!]+(station|village|school|centre|public\s+school)/i.test(t) ||
    /\bnear\s+[A-Za-z0-9\s]+(station|village|school|centre)\s*\.?\s*$/i.test(t) ||
    /\bsearch\s+(for\s+)?propert/i.test(t)
  );
};

/** Extract place name from "near X", "around X", "close to X", or from supported place/suburb lists. */
function getPlaceFromMessage(
  text: string,
  placeNames: string[],
  suburbNames: string[]
): string | null {
  const m = text.match(/(?:near|around|close to)\s+([^?.!]+?)(?:\?|\.|$)/i);
  if (m) return m[1].trim() || null;
  const combined = [...new Set([...placeNames, ...suburbNames])];
  const lower = text.toLowerCase();
  for (const s of combined) {
    if (s && lower.includes(s.toLowerCase())) return s;
  }
  return null;
}

/** User is saying they didn't specify or forgot to add the number of bedrooms. */
const isUserSayingDidNotSpecifyBedrooms = (text: string): boolean => {
  const t = text.toLowerCase();
  return (
    /didn't put in the number|did not put in the number|didn't specify|did not specify|forgot to (add|put|mention)|didn't (add|put|mention|say).*bedroom|number of (bedroom|apartment)/i.test(t) ||
    /i (didn't|did not) (put|add|specify|mention|give)/i.test(t) ||
    /\bno (bedroom|number)\b.*(specify|put|add|mention)/i.test(t)
  );
};

/** Other off-topic (schools, crime, transport, etc.)—we don't have that data. */
const isOtherOffTopic = (text: string): boolean => {
  const t = text.toLowerCase();
  return (
    /\b(school|schools|good school|primary|secondary|university)\b/i.test(t) ||
    /\b(crime|safe|safety|transport|train|bus|restaurant|shop|shopping)\b/i.test(t) ||
    /\bdo you know\s+(a|any|some)\s+(good\s+)?/i.test(t) && !/price|propert|suburb|apartment|bedroom/i.test(t)
  );
};

/**
 * Build final reply: prefer the Vertex AI–generated reply; only overwrite when we must
 * (wrong intent, no data, or empty) so the model can produce natural responses.
 */
async function buildFinalReply(
  messages: BaseMessage[],
  userMessage: string
): Promise<string> {
  const [supportedSuburbs, supportedPlaceNames] = await Promise.all([
    getSupportedSuburbs(),
    getSupportedPlaceNames(),
  ]);
  const suburbNamesLower = supportedSuburbs.map((s) => s.toLowerCase());

  const lastAi = messages.filter((m): m is AIMessage => m instanceof AIMessage).pop();
  let reply =
    lastAi && typeof lastAi.content === 'string' ? String(lastAi.content).trim() : '';
  const {
    toolCallsLog,
    top10,
    lastToolWasPropertySearch,
    lastToolWasMarketEstimate,
    propertySearchRanThisTurn,
    marketEstimateContent,
    marketEstimateQuery,
  } = extractToolCallsAndResults(messages);

  let hadMarketEstimateSuccess = false;
  if (marketEstimateContent) {
    try {
      const d = JSON.parse(marketEstimateContent);
      hadMarketEstimateSuccess = !!(d && d.found === true);
    } catch (_) {}
  }

  const suburbUserAsked = ((): string | null => {
    let t = userMessage.toLowerCase();
    t = t.replace(/\bparrammatta\b/i, 'parramatta').replace(/\bparramata\b/i, 'parramatta');
    for (let i = 0; i < suburbNamesLower.length; i++) {
      if (t.includes(suburbNamesLower[i])) return supportedSuburbs[i];
    }
    return null;
  })();
  const bedsFromMessage = ((): number | null => {
    const t = userMessage.toLowerCase();
    if (/\b(three|3)\s*bed(room)?s?\b/i.test(t)) return 3;
    if (/\b(two|2)\s*bed(room)?s?\b/i.test(t)) return 2;
    if (/\b(one|1)\s*bed(room)?s?\b/i.test(t)) return 1;
    return null;
  })();

  /** True if the user mentioned a bedroom count (e.g. "2 bed", "one bedroom") or "any". */
  const userSpecifiedBedrooms = ((): boolean => {
    const t = userMessage.toLowerCase();
    return bedsFromMessage != null || /\bany\s*bed|\bany\s*bedroom|any\s*size/i.test(t);
  })();

  /** True if the message is only a bedroom answer (e.g. "2", "2 bedroom", "two bed"). */
  const isOnlyBedroomAnswer = ((): boolean => {
    const t = userMessage.trim().toLowerCase();
    return (
      (bedsFromMessage != null && t.length <= 25) ||
      /^(one|two|three|\d)\s*bed(room)?s?\.?$/i.test(t) ||
      /^\d+\.?$/.test(t)
    );
  })();

  const emptyOrGeneric = !reply || reply === "I couldn't generate a response.";
  const replyLooksLikePropertyList =
    reply.includes('Here are') && reply.includes('properties');

  // --- 0. Out-of-scope / comparison: never show a random price guide; say we can't compare suburbs ---
  if (isOutOfScopeOrComparison(userMessage)) {
    const examples = supportedSuburbs.length ? supportedSuburbs.slice(0, 3).join(', ') : 'e.g. Parramatta, Epping';
    return (
      `I can only give a price guide when you name a specific suburb (${examples}), and I can help find properties near a place you name. I can't compare suburbs or recommend which areas are cheaper. If you tell me a suburb, I can give you a price guide for it; or tell me an area and I can search for properties there.`
    );
  }

  // --- 0a. User says they didn't specify number of bedrooms: always ask for bedrooms ---
  if (isUserSayingDidNotSpecifyBedrooms(userMessage)) {
    return (
      "No problem — how many bedrooms are you looking for? (e.g. 1, 2, or 3). Once you tell me, I'll search for properties that match your criteria."
    );
  }

  // --- 0b. Other off-topic (schools, transport, etc.): friendly "I don't have that" message ---
  // Skip when user is asking to find properties near a place (e.g. "near James Ruse Public School" = location) or when we already ran property search
  if (
    isOtherOffTopic(userMessage) &&
    !isPropertySearchIntent(userMessage) &&
    !propertySearchRanThisTurn
  ) {
    const place = getPlaceFromMessage(userMessage, supportedPlaceNames, supportedSuburbs);
    const offer = place
      ? ` I can help you find properties near ${place} or give a price guide for that area if that's useful.`
      : ' I can help you find properties or give a price guide for a suburb you name.';
    return (
      "I'm designed for property search and price guides only. I don't have information about schools, transport, or other topics." + offer
    );
  }

  // --- 0c. Property search ran but model replied with off-topic disclaimer: use search result instead ---
  if (
    propertySearchRanThisTurn &&
    /designed for property search|don't have information about schools|don't have that information/i.test(reply)
  ) {
    if (top10.length > 0) {
      const toolsPhrase = toolCallsLog.length ? ` (${toolCallsLog.join(', ')})` : '';
      reply = `I found ${top10.length} properties that match your criteria${toolsPhrase}. You can review them above—let me know if you'd like more details or to refine the search.`;
    } else {
      reply = "I couldn't find any properties matching your criteria for that location. Try adjusting filters or a different area.";
    }
  }

  // --- 0d. Property search ran but model still replied with bedrooms question: use search result only if user did specify bedrooms ---
  if (
    propertySearchRanThisTurn &&
    userSpecifiedBedrooms &&
    /how many bedrooms|bedrooms are you looking for/i.test(reply)
  ) {
    if (top10.length > 0) {
      const toolsPhrase = toolCallsLog.length ? ` (${toolCallsLog.join(', ')})` : '';
      reply = `I found ${top10.length} properties that match your criteria${toolsPhrase}. You can review them above—let me know if you'd like more details or to refine the search.`;
    } else {
      reply = "I couldn't find any properties matching your criteria for that location. Try adjusting filters or a different area.";
    }
  }

  // --- 1. Price guide intent: always use suburb/beds from current message; fix wrong or stale reply ---
  if (isPriceGuideIntent(userMessage, supportedSuburbs)) {
    const replySuburb = ((): string | null => {
      const m = reply.match(/For\s+(\w+),?\s+your criteria:/i);
      return m ? m[1] : null;
    })();
    const replyIsWrongSuburb =
      suburbUserAsked != null &&
      replySuburb != null &&
      replySuburb.toLowerCase() !== suburbUserAsked.toLowerCase();
    const wrongReply =
      replyLooksLikePropertyList ||
      (!hadMarketEstimateSuccess && propertySearchRanThisTurn) ||
      replyIsWrongSuburb;

    if (wrongReply || !hadMarketEstimateSuccess || suburbUserAsked != null) {
      let usedData = false;
      if (suburbUserAsked) {
        try {
          const beds = bedsFromMessage ?? 2;
          const est = await getMarketEstimate(suburbUserAsked, beds, 2, 1);
          if (est) {
            const price = `around $${Number(est.avgPrice).toLocaleString()}`;
            const growth =
              est.growthRatePct != null ? ` (growth ~${est.growthRatePct}% over the period)` : '';
            reply = `For ${est.suburb}, your criteria: average price guide ${price}${growth}. Use this as a reference when making an offer.`;
            usedData = true;
          }
        } catch (_) {}
      }
      if (!usedData && (wrongReply || !hadMarketEstimateSuccess)) {
        reply =
          "I don't have enough data to give a price guide for that area and criteria. I can only provide price guides when I have market data for that suburb and bedroom count.";
      }
    }
  }
  // --- 2. Conversation intent: always summarise what the user actually asked (from human messages) ---
  else if (isConversationIntent(userMessage)) {
    const questions = messages
      .filter((m): m is HumanMessage => m instanceof HumanMessage)
      .map((m) => (typeof m.content === 'string' ? m.content.trim() : ''))
      .filter(Boolean);
    if (questions.length > 0) {
      const list = questions.map((q, i) => `(${i + 1}) ${q}`).join(' ');
      reply = `You've asked so far: ${list}. I can help with price guides for a specific suburb and with finding properties near a place—ask me for either.`;
    } else {
      reply =
        "I can only summarise from this chat. You've asked me to find properties and about price guides—use the conversation above for details.";
    }
  }
  // --- 2b. User wanted property search but model called price guide only: correct and ask to rephrase (we can't inject results here) ---
  else if (isPropertySearchIntent(userMessage) && lastToolWasMarketEstimate && !propertySearchRanThisTurn) {
    const place = getPlaceFromMessage(userMessage, supportedPlaceNames, supportedSuburbs);
    reply = place
      ? `It looks like you wanted to see properties near ${place}, not a price guide. Ask me e.g. "Find me 2 bedroom apartments near ${place}" and I'll search listings for you.`
      : "It looks like you wanted to see properties. Ask me e.g. 'Find me 2 bedroom apartments near [place or station]' and I'll search listings.";
  }
  // --- 2c. Property search ran this turn but reply is a price guide (wrong/stale): use property search result ---
  else if (propertySearchRanThisTurn && /For\s+\w+,?\s+your criteria:\s*average price guide/i.test(reply)) {
    if (top10.length > 0) {
      const toolsPhrase = toolCallsLog.length ? ` (${toolCallsLog.join(', ')})` : '';
      reply = `I found ${top10.length} properties that match your criteria${toolsPhrase}. You can review them above—let me know if you'd like more details or to refine the search.`;
    } else {
      reply = "I couldn't find any properties matching your criteria for that location. Try adjusting filters or a different area.";
    }
  }
  // --- 2d. Property search intent but no bedrooms specified: always prompt for bedrooms (even if search ran with default) ---
  else if (isPropertySearchIntent(userMessage) && !userSpecifiedBedrooms) {
    reply =
      "How many bedrooms are you looking for? (e.g. 1, 2, or 3). Once you tell me, I'll search for properties that match your criteria.";
  }
  // --- 2e. User answered with bedroom count (e.g. "2 bedroom") but model didn't run search: don't repeat the question ---
  else if (
    userSpecifiedBedrooms &&
    isOnlyBedroomAnswer &&
    !propertySearchRanThisTurn &&
    /how many bedrooms|bedrooms are you looking for/i.test(reply)
  ) {
    const n = bedsFromMessage ?? 2;
    reply = `Got it — ${n} bedroom${n === 1 ? '' : 's'}. Please ask again with the full request, e.g. "Find me a quiet ${n} bed apartment with natural light near James Ruse Public School," and I'll run the search.`;
  }
  // --- 3. Empty reply: minimal fallbacks so we never return blank ---
  else if (emptyOrGeneric) {
    if (propertySearchRanThisTurn) {
      if (top10.length > 0) {
        const toolsPhrase = toolCallsLog.length ? ` (${toolCallsLog.join(', ')})` : '';
        reply = `Here are ${top10.length} properties that might be of your interest${toolsPhrase}. Let me know if I could help you further!`;
      } else {
        reply = "I couldn't find any properties matching your criteria. Try adjusting filters or location.";
      }
    } else if (hadMarketEstimateSuccess && marketEstimateContent && lastToolWasMarketEstimate) {
      try {
        const data = JSON.parse(marketEstimateContent);
        if (data?.found && data?.suburb != null) {
          const price = data.avgPrice != null ? `around $${Number(data.avgPrice).toLocaleString()}` : 'no average price data';
          const growth = data.growthRatePct != null ? ` (growth ~${data.growthRatePct}% over the period)` : '';
          reply = `For ${data.suburb}, your criteria: average price guide ${price}${growth}. Use this as a reference when making an offer.`;
        } else {
          reply = data?.message ?? "I don't have enough market data for that area and criteria.";
        }
      } catch (_) {
        reply = "I don't have enough market data to give a price guide.";
      }
    } else {
      reply = reply || "I couldn't generate a response.";
    }
  }

  return reply;
}

const stepLabels: Record<string, string> = {
  get_poi_coordinates: 'POI lookup: resolve location coordinates',
  geo_search: 'Geo search: filter by distance from location',
  vector_search: 'Vector search: semantic + lexical prefilters (Atlas Search)',
  reranker: 'Reranker: Voyage rerank-2.5-lite',
  property_search: 'Property search (runs geo + vector + rerank)',
  get_market_estimate: 'Market data: suburb price guide',
};

/**
 * Run the agent with graph state and session persisted in MongoDB (thread_id = sessionId).
 * Conditional edges: agent → tools (if tool_calls) or respond (end); tools → agent; respond → END.
 * Final reply is always produced by the respond node to avoid hallucination.
 */
export async function runAgent(
  messages: BaseMessage[],
  userMessage: string,
  options?: {
    preferences?: UserPreferences;
    sessionId?: string;
    memoryContext?: string;
  }
): Promise<AgentResult> {
  const agent = await getAgent();
  const prefsMessage =
    options?.preferences != null
      ? [new SystemMessage(formatPreferencesContext(options.preferences))]
      : [];
  const fullMessages: BaseMessage[] = [
    ...prefsMessage,
    ...messages,
    new HumanMessage(userMessage),
  ];

  const config: { configurable: Record<string, unknown> } = {
    configurable: {
      preferences: options?.preferences,
      memoryContext: options?.memoryContext,
    },
  };
  if (options?.sessionId) {
    config.configurable.thread_id = options.sessionId;
  }

  const result = (await agent.invoke(
    { messages: fullMessages },
    config
  )) as AgentState & { finalReply?: string };

  const outMessages = (result.messages ?? fullMessages) as BaseMessage[];
  const reply = result.finalReply ?? '';
  let {
    toolCallsLog,
    top10,
    aggregationPipeline,
    marketEstimateQuery,
  } = extractToolCallsAndResults(outMessages);

  let finalMarketEstimateQuery: object | undefined = marketEstimateQuery ?? undefined;
  if (!finalMarketEstimateQuery) {
    const { marketEstimateContent } = extractToolCallsAndResults(outMessages);
    if (marketEstimateContent) {
      try {
        const data = JSON.parse(marketEstimateContent);
        if (data?.found && data.suburb != null) {
          finalMarketEstimateQuery = {
            suburb: data.suburb,
            beds: data.beds ?? 2,
            baths: data.baths ?? 2,
            parking: data.parking ?? 1,
          };
        }
      } catch (_) {}
    }
  }

  // When reply is a price guide but the model didn't log the tool call, show tool + query in UI
  const replyIsPriceGuide =
    /For\s+(\w+),?\s+your criteria:\s*average price guide/i.test(reply) ||
    (/average price guide/i.test(reply) && /For\s+\w+/i.test(reply));
  if (replyIsPriceGuide && !toolCallsLog.includes('get_market_estimate')) {
    toolCallsLog = [...toolCallsLog, 'get_market_estimate'];
    if (!finalMarketEstimateQuery) {
      const suburbMatch = reply.match(/For\s+(\w+)/i);
      const suburb = suburbMatch ? suburbMatch[1] : null;
      const beds = /\b(three|3)\s*bed/i.test(userMessage) ? 3 : /\b(two|2)\s*bed/i.test(userMessage) ? 2 : 2;
      if (suburb) {
        finalMarketEstimateQuery = { suburb, beds, baths: 2, parking: 1 };
      }
    }
  }

  // When reply is "no properties found" but tools weren't logged (e.g. 0 results path), show property search pipeline in UI
  const replyIsNoProperties =
    /I couldn't find any properties matching your criteria/i.test(reply) ||
    /I couldn't find any properties\./i.test(reply);
  if (replyIsNoProperties && !toolCallsLog.includes('property_search')) {
    toolCallsLog = ['property_search', 'geo_search', 'vector_search', 'reranker'];
  }

  const pipelineSteps =
    toolCallsLog.length > 0 ? toolCallsLog.map((t) => stepLabels[t] || t) : undefined;

  return {
    reply,
    toolCallsLog,
    top10,
    pipelineSteps,
    aggregationPipeline: aggregationPipeline ?? undefined,
    marketEstimateQuery: finalMarketEstimateQuery,
  };
}
