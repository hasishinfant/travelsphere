import React, { useState, useEffect } from 'react';
import {
  HeartPulse, FileText, Hotel, Compass, AlertCircle, Clock, ArrowRight, ChevronRight, Siren, ClipboardList, Ban, Activity,
} from 'lucide-react';
import { complaintService, EmergencyComplaintRecord } from '@/services/complaintService';
import { getSession } from '@/services/apiClient';
import { getMyRole } from '@/services/emergency';
import { SOSButton } from './SOSButton';
import { EmergencyCallPanel } from './EmergencyCallPanel';
import { NearbyResources } from './NearbyResources';
import { IncidentList } from './IncidentList';

interface EmergencyLandingViewProps {
  onSelectCategory: (category: 'medical' | 'passport' | 'hotel' | 'local') => void;
  onViewHistory: () => void;
  onViewRequestDetail: (requestId: string) => void;
  onOpenResponderConsole?: () => void;
}

export const EmergencyLandingView: React.FC<EmergencyLandingViewProps> = ({
  onSelectCategory,
  onViewHistory,
  onViewRequestDetail,
  onOpenResponderConsole,
}) => {
  const [activeRequests, setActiveRequests] = useState<EmergencyComplaintRecord[]>([]);
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => {
    if (!getSession()) return;
    getMyRole().then(p => setIsStaff(p.role === 'responder' || p.role === 'admin')).catch(() => setIsStaff(false));
  }, []);

  useEffect(() => {
    const loadRequests = () => {
      const all = complaintService.getStoredRequests();
      setActiveRequests(all);
    };

    loadRequests();
    window.addEventListener('emergency-requests-updated', loadRequests);
    return () => window.removeEventListener('emergency-requests-updated', loadRequests);
  }, []);

  // Hotel complaints are kept on this device only; everything else is stored on the server (IncidentList)
  const deviceOnly = activeRequests;

  const categories = [
    {
      id: 'medical' as const,
      title: 'Medical Emergency',
      icon: HeartPulse,
      badge: 'Registered incident',
      badgeClass: 'badge-medical',
      description: 'Record a medical problem for TravelSphere responders. For emergencies, call the numbers above.',
      actionText: 'Report a medical problem',
      accentColor: 'var(--danger)',
    },
    {
      id: 'passport' as const,
      title: 'Lost Passport & Documents',
      icon: FileText,
      badge: 'Registered incident',
      badgeClass: 'badge-passport',
      description: 'Record lost or stolen documents and see what to do next. TravelSphere does not contact embassies.',
      actionText: 'Report Lost Documents',
      accentColor: 'var(--accent)',
    },
    {
      id: 'hotel' as const,
      title: 'Hotel & Accommodation Issue',
      icon: Hotel,
      badge: 'Saved on this device',
      badgeClass: 'badge-hotel-featured',
      description: 'Keep a dated record of booking, cleanliness, billing or check-in problems. It is not sent to the hotel.',
      actionText: 'File Hotel Complaint',
      accentColor: 'var(--success)',
      isFeatured: true,
    },
    {
      id: 'local' as const,
      title: 'Local Travel Assistance',
      icon: Compass,
      badge: 'Registered incident',
      badgeClass: 'badge-local',
      description: 'Ask TravelSphere responders for help with transport, directions, translation or local safety.',
      actionText: 'Request local help',
      accentColor: 'var(--pro)',
    },
  ];

  return (
    <div className="emergency-landing-wrapper">
      {/* Page Header */}
      <div className="emergency-page-header">
        <header className="page-header fade-up">
          <div>
            <h1 className="page-title">Emergency support</h1>
            <p className="page-subtitle">
              Local emergency numbers, nearby hospitals and police, and incident reports that TravelSphere responders can see.
            </p>
          </div>
        </header>

        {/* Compact, accessible critical notice */}
        <div className="emergency-critical-notice" role="alert">
          <div className="notice-icon-box">
            <AlertCircle size={20} />
          </div>
          <div className="notice-content">
            <p className="notice-headline">
              <strong>Life-threatening emergency?</strong> Call your local emergency services directly. TravelSphere does not contact police, ambulance or hospitals for you.
            </p>
            <EmergencyCallPanel />
          </div>
        </div>
      </div>

      {/* SOS Quick-Alert Banner */}
      <div className="sos-banner-section">
        <div className="sos-banner-left">
          <div className="sos-banner-icon">
            <Siren size={22} strokeWidth={2.2} />
          </div>
          <div className="sos-banner-text">
            <h3>Need help right now?</h3>
            <p>SOS shows your local emergency numbers and can register a critical incident with your location for TravelSphere responders.</p>
          </div>
        </div>
        <SOSButton onTrack={onViewRequestDetail} />
      </div>

      {/* Top Navigation Row / Switcher */}
      <div className="emergency-nav-row">
        <div className="emergency-tabs-group">
          <button type="button" className="emergency-nav-tab active">
            Assistance Categories
          </button>
          <button 
            type="button" 
            className="emergency-nav-tab"
            onClick={onViewHistory}
          >
            <span>My incidents & saved complaints</span>
          </button>
          {isStaff && onOpenResponderConsole && (
            <button type="button" className="emergency-nav-tab" onClick={onOpenResponderConsole}>Responder console</button>
          )}
        </div>
      </div>

      {/* 4 Assistance Categories Grid */}
      <div className="assistance-categories-grid">
        {categories.map((cat) => {
          const IconComponent = cat.icon;
          return (
            <div
              key={cat.id}
              className={`category-assistance-card ${cat.isFeatured ? 'featured-card' : ''}`}
              onClick={() => onSelectCategory(cat.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectCategory(cat.id);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`${cat.title} - ${cat.actionText}`}
            >
              <div className="card-top-row">
                <div 
                  className="category-icon-wrapper"
                  style={{ backgroundColor: `color-mix(in srgb, ${cat.accentColor} 10%, transparent)`, color: cat.accentColor }}
                >
                  <IconComponent size={24} strokeWidth={2.2} />
                </div>
                <span className={`category-pill-badge ${cat.badgeClass}`}>
                  {cat.badge}
                </span>
              </div>

              <div className="card-text-body">
                <h3 className="category-card-title">{cat.title}</h3>
                <p className="category-card-desc">{cat.description}</p>
              </div>

              <div className="card-action-footer">
                <span className="card-action-btn">
                  <span>{cat.actionText}</span>
                  <ArrowRight size={16} className="btn-arrow" />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <NearbyResources />

      <div className="recent-requests-preview-section">
        <div className="section-header-row">
          <div>
            <h3 className="preview-heading">Your incidents</h3>
            <p className="preview-subtext">Registered with TravelSphere. Statuses change only when a responder changes them.</p>
          </div>
          <button type="button" className="btn-text-link" onClick={onViewHistory}>
            <span>View all</span>
            <ChevronRight size={16} />
          </button>
        </div>
        <IncidentList onSelect={onViewRequestDetail} limit={3} emptyText="You haven’t registered any incidents." />
      </div>

      {deviceOnly.length > 0 && (
        <div className="recent-requests-preview-section">
          <div className="section-header-row">
            <div>
              <h3 className="preview-heading">Saved on this device only</h3>
              <p className="preview-subtext">These were never sent to TravelSphere, a hotel or anyone else.</p>
            </div>
          </div>
          <div className="recent-tickets-cards">
            {deviceOnly.slice(0, 2).map((req) => (
              <div key={req.id} className="recent-ticket-row-card" onClick={() => onViewRequestDetail(req.id)}>
                <div className="ticket-row-left">
                  <div className="ticket-status-pill status-submitted">Device only</div>
                  <div>
                    <h4 className="ticket-ref-title">
                      {req.id}
                      {req.category === 'hotel' && <span className="hotel-name-tag"> • {(req as any).hotelName}</span>}
                    </h4>
                    <p className="ticket-subject-text">
                      {req.category === 'hotel' ? (req as any).complaintSubject : (req as any).description?.slice(0, 80) + '...'}
                    </p>
                  </div>
                </div>
                <div className="ticket-row-right">
                  <span className="ticket-date-text"><Clock size={13} /> {new Date(req.createdAt).toLocaleDateString()}</span>
                  <button type="button" className="btn-track-ticket"><span>Open</span><ArrowRight size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What this service does and does not do */}
      <div className="emergency-protocols-row">
        <div className="protocol-item">
          <div className="protocol-icon-circle"><ClipboardList size={18} /></div>
          <div>
            <h4>Registers incidents</h4>
            <p>Medical, lost-document, local-help and SOS reports are stored on TravelSphere’s server with a reference number.</p>
          </div>
        </div>
        <div className="protocol-item">
          <div className="protocol-icon-circle"><Ban size={18} /></div>
          <div>
            <h4>Doesn’t dispatch help</h4>
            <p>TravelSphere does not contact police, ambulance, hospitals, embassies or hotels, and has no guaranteed response time.</p>
          </div>
        </div>
        <div className="protocol-item">
          <div className="protocol-icon-circle"><Activity size={18} /></div>
          <div>
            <h4>Shows real status</h4>
            <p>“Acknowledged” or “resolved” appears only after a TravelSphere responder sets it.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
