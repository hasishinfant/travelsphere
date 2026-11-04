import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, Check, MapPin } from 'lucide-react';
import { SAMPLE_DESTINATIONS } from '../../utils/constants';
import { sizedImage } from '@/data/destinations';
import './DestinationDropdown.css';

interface DestinationDropdownProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const DestinationDropdown: React.FC<DestinationDropdownProps> = ({ value, onChange, error }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlight, setHighlight] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredDestinations = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return SAMPLE_DESTINATIONS.filter(d =>
      d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)
    );
  }, [searchTerm]);

  useEffect(() => setHighlight(0), [searchTerm, isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedDestination = SAMPLE_DESTINATIONS.find(dest => dest.id === value);

  const handleSelect = (destinationId: string) => {
    onChange(destinationId);
    setIsOpen(false);
    setSearchTerm('');
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filteredDestinations.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); const d = filteredDestinations[highlight]; if (d) handleSelect(d.id); }
    if (e.key === 'Escape') setIsOpen(false);
  };

  return (
    <div className="destination-dropdown" ref={dropdownRef}>
      <label htmlFor="destination" className="visually-hidden">Destination</label>
      <div className="dropdown-container">
        <button
          id="destination"
          type="button"
          className={`dropdown-trigger ${error ? 'error' : ''} ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          {selectedDestination ? (
            <img className="dropdown-thumb" src={sizedImage(selectedDestination.imageUrl, 80, 80)} alt="" />
          ) : (
            <span className="dropdown-thumb is-empty"><MapPin size={18} /></span>
          )}
          <span className={`dropdown-value ${selectedDestination ? '' : 'is-placeholder'}`}>
            {selectedDestination ? selectedDestination.name : 'Where do you want to go?'}
          </span>
          <ChevronDown size={18} className={`dropdown-arrow ${isOpen ? 'open' : ''}`} />
        </button>

        {isOpen && (
          <div className="dropdown-menu">
            <div className="dropdown-search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search destinations"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={onSearchKey}
                className="search-input"
                aria-label="Search destinations"
                autoFocus
              />
            </div>
            <div className="dropdown-options" role="listbox">
              {filteredDestinations.length > 0 ? (
                filteredDestinations.map((destination, i) => (
                  <button
                    key={destination.id}
                    type="button"
                    className={`dropdown-option ${value === destination.id ? 'selected' : ''} ${i === highlight ? 'highlight' : ''}`}
                    onClick={() => handleSelect(destination.id)}
                    onMouseEnter={() => setHighlight(i)}
                    role="option"
                    aria-selected={value === destination.id}
                  >
                    <img
                      src={sizedImage(destination.imageUrl, 96, 96)}
                      alt={destination.name}
                      className="destination-image"
                      loading="lazy"
                    />
                    <div className="destination-info">
                      <div className="destination-name">{destination.name}</div>
                      <div className="destination-description">{destination.description}</div>
                    </div>
                    {value === destination.id && <Check size={16} className="dropdown-check" />}
                  </button>
                ))
              ) : (
                <div className="no-results">No destinations match “{searchTerm}”</div>
              )}
            </div>
          </div>
        )}
      </div>
      {error && <div className="error-message">{error}</div>}
    </div>
  );
};

export default DestinationDropdown;
