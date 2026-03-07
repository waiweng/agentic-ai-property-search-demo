import { useState, useEffect, useRef, useCallback } from 'react';
import type { Preferences } from '../api/client';
import { getLocationSuggestions, type LocationSuggestion } from '../api/client';

const BEDROOMS = [1, 2, 3, 4];
const BATHROOMS = [1, 2, 3];
const PARKING = [0, 1, 2];

export interface FilterSearchParams {
  bedrooms: number;
  bathrooms: number;
  parking: number;
  location: string;
  priceMin?: number;
  priceMax?: number;
}

interface FilterBarProps {
  userId: string;
  prefs: Preferences | null;
  onPrefsSaved?: (prefs: Preferences) => void;
  onSaveError?: (message: string) => void;
  onSearch?: (params: FilterSearchParams) => void;
  searchLoading?: boolean;
}

export function FilterBar({ userId, prefs, onPrefsSaved, onSaveError, onSearch, searchLoading }: FilterBarProps) {
  const [bedrooms, setBedrooms] = useState(2);
  const [bathrooms, setBathrooms] = useState(2);
  const [parking, setParking] = useState(1);
  const [location, setLocation] = useState('Carlingford');
  const [locationInput, setLocationInput] = useState('Carlingford');
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationContainerRef = useRef<HTMLDivElement>(null);
  const [priceMin, setPriceMin] = useState<number | ''>('');
  const [priceMax, setPriceMax] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  const fetchSuggestions = useCallback((query: string) => {
    if (!query.trim()) {
      setLocationSuggestions([]);
      setLocationDropdownOpen(false);
      return;
    }
    setLocationLoading(true);
    getLocationSuggestions(query)
      .then((s) => {
        setLocationSuggestions(s);
        setLocationDropdownOpen(s.length > 0);
      })
      .catch(() => {
        setLocationSuggestions([]);
        setLocationDropdownOpen(false);
      })
      .finally(() => setLocationLoading(false));
  }, []);

  useEffect(() => {
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    locationDebounceRef.current = setTimeout(() => {
      fetchSuggestions(locationInput);
      locationDebounceRef.current = null;
    }, 250);
    return () => {
      if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    };
  }, [locationInput, fetchSuggestions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (locationContainerRef.current && !locationContainerRef.current.contains(e.target as Node)) {
        setLocationDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!prefs) return;
    setBedrooms(prefs.bedrooms);
    setBathrooms(prefs.bathrooms);
    setParking(prefs.parking);
    setLocation(prefs.suburbPreference);
    setLocationInput(prefs.suburbPreference);
    setPriceMin(prefs.priceMin ?? '');
    setPriceMax(prefs.priceMax ?? '');
  }, [prefs]);

  const selectLocation = (name: string) => {
    setLocation(name);
    setLocationInput(name);
    setLocationDropdownOpen(false);
    setLocationSuggestions([]);
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    const loc = locationInput.trim() || location;
    try {
      const { savePreferences } = await import('../api/client');
      const updated = await savePreferences(userId, {
        bedrooms,
        bathrooms,
        parking,
        suburbPreference: loc,
        referencePoint: loc,
        defaultRadiusKm: 5,
        priceMin: priceMin === '' ? undefined : Number(priceMin),
        priceMax: priceMax === '' ? undefined : Number(priceMax),
      });
      onPrefsSaved?.(updated);
    } catch (e) {
      console.error(e);
      onSaveError?.(e instanceof Error ? e.message : 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="filter-bar">
      <div className="filter-bar-summary">
        Saved: {prefs?.bedrooms ?? bedrooms} bed, {prefs?.bathrooms ?? bathrooms} bath, {prefs?.parking ?? parking} parking
        {' · '} Near {prefs?.suburbPreference ?? location} ({(prefs?.defaultRadiusKm ?? 5)} km)
      </div>
      <div className="filter-bar-controls">
        <label>
          Beds
          <select value={bedrooms} onChange={(e) => setBedrooms(Number(e.target.value))}>
            {BEDROOMS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Baths
          <select value={bathrooms} onChange={(e) => setBathrooms(Number(e.target.value))}>
            {BATHROOMS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Parking
          <select value={parking} onChange={(e) => setParking(Number(e.target.value))}>
            {PARKING.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div ref={locationContainerRef} className="filter-bar-location-wrap">
          <label>
            Location
            <div className="filter-bar-location-input-wrap">
            <input
              type="text"
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              onFocus={() => locationSuggestions.length > 0 && setLocationDropdownOpen(true)}
              placeholder="e.g. Carlingford"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={locationDropdownOpen}
            />
            {locationLoading && <span className="filter-bar-location-loading" aria-hidden>…</span>}
            {locationDropdownOpen && locationSuggestions.length > 0 && (
              <ul className="filter-bar-location-dropdown" role="listbox">
                {locationSuggestions.map((s) => (
                  <li
                    key={s.name}
                    role="option"
                    tabIndex={0}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectLocation(s.name);
                    }}
                  >
                    {s.name}
                    {s.type && <span className="filter-bar-location-type">{s.type}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          </label>
        </div>
        <label>
          Price min
          <input
            type="number"
            placeholder="Min"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value === '' ? '' : Number(e.target.value))}
            min={0}
            step={50000}
          />
        </label>
        <label>
          Price max
          <input
            type="number"
            placeholder="Max"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value === '' ? '' : Number(e.target.value))}
            min={0}
            step={50000}
          />
        </label>
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        <button
          type="button"
          className="filter-bar-search-btn"
          onClick={() =>
            onSearch?.({
              bedrooms,
              bathrooms,
              parking: parking,
              location: locationInput.trim() || location,
              priceMin: priceMin === '' ? undefined : Number(priceMin),
              priceMax: priceMax === '' ? undefined : Number(priceMax),
            })
          }
          disabled={searchLoading}
        >
          {searchLoading ? 'Searching…' : 'Search'}
        </button>
      </div>
    </div>
  );
}
