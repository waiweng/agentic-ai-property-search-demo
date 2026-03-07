import './ToolCallsBadge.css';

interface ToolCallsBadgeProps {
  tools: string[];
}

const LABELS: Record<string, string> = {
  get_poi_coordinates: 'POI lookup',
  property_search: 'Property search',
  get_market_estimate: 'Market data',
  geo_search: 'Geo search',
  vector_search: 'Vector search',
  reranker: 'Reranker',
  filter_search: 'Filter search',
};

export function ToolCallsBadge({ tools }: ToolCallsBadgeProps) {
  if (!tools?.length) return null;
  return (
    <div className="tool-calls-badge">
      <span className="tool-calls-label">Tools used:</span>
      {tools.map((t) => (
        <span key={t} className="tool-chip">
          {LABELS[t] || t}
        </span>
      ))}
    </div>
  );
}
