import React, { useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { mapEmbedUrl, type DestinationRecord } from '@/data/destinations';

interface MapModalProps {
  destination: DestinationRecord;
  onClose: () => void;
}

/** Satellite map of the landmark shown in the destination photo. */
const MapModal: React.FC<MapModalProps> = ({ destination: d, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const external = `https://www.google.com/maps/search/?api=1&query=${d.coordinates[0]},${d.coordinates[1]}`;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-content map-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="map-modal-title" className="map-modal-title">{d.imageCaption || d.city}</h2>
            <p className="text-muted">{d.name}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close map">
            <X size={20} />
          </button>
        </div>
        <div className="map-modal-frame">
          <iframe
            title={`Map of ${d.imageCaption || d.city}`}
            src={mapEmbedUrl(d)}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>
        <div className="map-modal-foot">
          <a className="btn btn-secondary btn-sm" href={external} target="_blank" rel="noreferrer">
            Open in Google Maps <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );
};

export default MapModal;
