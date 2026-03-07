import { useMemo } from 'react';
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api';
import type { PropertySummary } from '../api/client';

const DEFAULT_CENTER = { lat: -33.7819, lng: 151.0485 };
const DEFAULT_ZOOM = 13;
const MAP_CONTAINER_STYLE = { width: '100%', height: '100%', minHeight: 300 };

interface MapProps {
  properties: PropertySummary[];
  selectedId?: string;
  onSelect?: (p: PropertySummary | null) => void;
}

export function Map({ properties, selectedId, onSelect }: MapProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
  });

  const selected = useMemo(
    () => properties.find((p) => p._id === selectedId),
    [properties, selectedId]
  );

  const withCoords = useMemo(
    () => properties.filter((p) => (p.location?.coordinates?.length ?? 0) >= 2),
    [properties]
  );
  const hasPropertiesNoCoords = properties.length > 0 && withCoords.length === 0;

  if (loadError) {
    return (
      <div className="map-container map-error">
        <p>Google Maps failed to load. Set VITE_GOOGLE_MAPS_KEY in .env</p>
      </div>
    );
  }

  if (!isLoaded || !apiKey) {
    return (
      <div className="map-container map-placeholder">
        <p>Loading map… (set VITE_GOOGLE_MAPS_KEY for Google Maps)</p>
      </div>
    );
  }

  return (
    <div className="map-container">
      {hasPropertiesNoCoords && (
        <p className="map-no-coords-msg">No location data for these properties — map cannot plot them.</p>
      )}
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
      >
        {withCoords.map((p) => (
            <Marker
              key={p._id}
              position={{
                lat: p.location!.coordinates![1],
                lng: p.location!.coordinates![0],
              }}
              onClick={() => onSelect?.(p)}
            />
          ))}
        {selected && (selected.location?.coordinates?.length ?? 0) >= 2 && (
          <InfoWindow
            position={{
              lat: selected.location!.coordinates![1],
              lng: selected.location!.coordinates![0],
            }}
            onCloseClick={() => onSelect?.(null)}
          >
            <div className="map-info">
              <strong>{selected.title}</strong>
              <div>{selected.suburb} · ${selected.price?.toLocaleString()}</div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  );
}
