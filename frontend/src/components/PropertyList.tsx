import type { PropertySummary } from '../api/client';

interface PropertyListProps {
  properties: PropertySummary[];
  onSelect?: (p: PropertySummary) => void;
  selectedId?: string;
  /** Optional heading (e.g. "Recommendations", "Search results (12)"). */
  title?: string;
  emptyMessage?: string;
}

export function PropertyList({ properties, onSelect, selectedId, title, emptyMessage }: PropertyListProps) {
  if (!properties.length) {
    return (
      <div className="property-list empty">
        <p>{emptyMessage ?? 'No properties.'}</p>
      </div>
    );
  }
  return (
    <div className="property-list">
      {title && <h3>{title}</h3>}
      <ul>
        {properties.map((p) => (
          <li
            key={p._id}
            className={selectedId === p._id ? 'selected' : ''}
            onClick={() => onSelect?.(p)}
          >
            <div className="prop-title">{p.title}</div>
            <div className="prop-meta">
              {p.suburb} · <span className="prop-price">${p.price?.toLocaleString() ?? ''}</span> · {p.bedrooms}b {p.bathrooms}ba {p.parking}p
            </div>
            {p.description && <div className="prop-desc">{p.description}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
