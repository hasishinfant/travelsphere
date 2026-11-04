import React, { useState, useEffect } from 'react';
import { Headphones,
  HeartPulse, FileText, Hotel, Compass, AlertCircle, Phone, 
  ShieldAlert, Clock, ArrowRight, CheckCircle2, ChevronRight,
  ExternalLink, Siren
} from 'lucide-react';
import { complaintService, EmergencyComplaintRecord } from '@/services/complaintService';
import { SOSButton } from './SOSButton';

interface EmergencyLandingViewProps {
  onSelectCategory: (category: 'medical' | 'passport' | 'hotel' | 'local') => void;
  onViewHistory: () => void;
  onViewRequestDetail: (requestId: string) => void;
}

export const EmergencyLandingView: React.FC<EmergencyLandingViewProps> = ({
  onSelectCategory,
  onViewHistory,
  onViewRequestDetail,
}) => {
  const [activeRequests, setActiveRequests] = useState<EmergencyComplaintRecord[]>([]);

  useEffect(() => {
    const loadRequests = () => {
      const all = complaintService.getStoredRequests();
      setActiveRequests(all);
    };

    loadRequests();
    window.addEventListener('emergency-requests-updated', loadRequests);
    return () => window.removeEventListener('emergency-requests-updated', loadRequests);
  }, []);

  const openTickets = activeRequests.filter(r => r.status !== 'resolved' && r.status !== 'rejected');

  const categories = [
    {
      id: 'medical' as const,
      title: 'Medical Emergency',
      icon: HeartPulse,
      badge: 'Rapid Priority',
      badgeClass: 'badge-medical',
      description: 'Medical assistance, healthcare guidance, and relevant local resources.',
      actionText: 'Request Medical Help',
      accentColor: 'var(--danger)',
    },
    {
      id: 'passport' as const,
      title: 'Lost Passport & Documents',
      icon: FileText,
      badge: 'Consular Assistance',
      badgeClass: 'badge-passport',
      description: 'Guidance for lost or stolen travel documents and relevant consular assistance.',
      actionText: 'Report Lost Documents',
      accentColor: 'var(--accent)',
    },
    {
      id: 'hotel' as const,
      title: 'Hotel & Accommodation Issue',
      icon: Hotel,
      badge: 'Multi-Hotel Support',
      badgeClass: 'badge-hotel-featured',
      description: 'Report booking disputes, room cleanliness issues, billing discrepancies, or check-in problems.',
      actionText: 'File Hotel Complaint',
      accentColor: 'var(--success)',
      isFeatured: true,
    },
    {
      id: 'local' as const,
      title: 'Local Travel Assistance',
      icon: Compass,
      badge: '24/7 Companion',
      badgeClass: 'badge-local',
      description: 'Request travel-related assistance with transport, local navigation, and other relevant issues.',
      actionText: 'Request Local Help',
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
              Help with medical situations, lost documents, hotel disputes and travel disruptions — around the clock.
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
              <strong>Life-Threatening Emergency Notice:</strong> For immediate medical, fire, or police emergencies, please dial your local emergency services directly.
            </p>
            <div className="emergency-numbers-chips">
              <a className="number-chip" href="tel:911"><Phone size={13} /> US/Canada <strong>911</strong></a>
              <a className="number-chip" href="tel:112"><Phone size={13} /> UK/Europe <strong>112 / 999</strong></a>
              <a className="number-chip" href="tel:112"><Phone size={13} /> Asia <strong>112 / 100</strong></a>
              <span className="number-chip hotline"><Headphones size={13} /> SOS Travel Desk <strong>+1-800-555-SAFE</strong></span>
            </div>
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
            <h3>Need Help Right Now?</h3>
            <p>Tap SOS to send an instant emergency alert with your location to any phone number.</p>
          </div>
        </div>
        <SOSButton />
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
            <span>My Requests & Complaints</span>
            {activeRequests.length > 0 && (
              <span className="ticket-count-badge">{activeRequests.length}</span>
            )}
          </button>
        </div>

        {openTickets.length > 0 && (
          <div className="active-ticket-indicator" onClick={onViewHistory}>
            <span className="pulse-dot" />
            <span>{openTickets.length} Active {openTickets.length === 1 ? 'ticket' : 'tickets'} in progress</span>
            <ChevronRight size={14} />
          </div>
        )}
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

      {/* Recent Request Preview (if user has submitted tickets) */}
      {activeRequests.length > 0 && (
        <div className="recent-requests-preview-section">
          <div className="section-header-row">
            <div>
              <h3 className="preview-heading">Recent Requests & Complaint Status</h3>
              <p className="preview-subtext">Track updates, hotel responses, and liaison actions in real-time</p>
            </div>
            <button type="button" className="btn-text-link" onClick={onViewHistory}>
              <span>View All ({activeRequests.length})</span>
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="recent-tickets-cards">
            {activeRequests.slice(0, 2).map((req) => (
              <div 
                key={req.id} 
                className="recent-ticket-row-card"
                onClick={() => onViewRequestDetail(req.id)}
              >
                <div className="ticket-row-left">
                  <div className={`ticket-status-pill status-${req.status}`}>
                    {req.status === 'in_progress' ? 'In Progress' : req.status === 'under_review' ? 'Under Review' : req.status === 'resolved' ? 'Resolved' : 'Submitted'}
                  </div>
                  <div>
                    <h4 className="ticket-ref-title">
                      {req.id}
                      {req.category === 'hotel' && (
                        <span className="hotel-name-tag"> • {(req as any).hotelName}</span>
                      )}
                    </h4>
                    <p className="ticket-subject-text">
                      {req.category === 'hotel' 
                        ? (req as any).complaintSubject 
                        : (req as any).description?.slice(0, 80) + '...'}
                    </p>
                  </div>
                </div>

                <div className="ticket-row-right">
                  <span className="ticket-date-text">
                    <Clock size={13} /> {new Date(req.createdAt).toLocaleDateString()}
                  </span>
                  <button type="button" className="btn-track-ticket">
                    <span>View Timeline</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Protocol & Guarantee Guarantee Highlights */}
      <div className="emergency-protocols-row">
        <div className="protocol-item">
          <div className="protocol-icon-circle">
            <Clock size={18} />
          </div>
          <div>
            <h4>15-Minute Response Protocol</h4>
            <p>Our 24/7 emergency dispatch verifies and initiates action on all high-severity requests in under 15 minutes.</p>
          </div>
        </div>

        <div className="protocol-item">
          <div className="protocol-icon-circle">
            <Hotel size={18} />
          </div>
          <div>
            <h4>Direct Hotel Escalation</h4>
            <p>We work directly with hotel management to enforce room quality, rectify billing, or arrange immediate re-accommodations.</p>
          </div>
        </div>

        <div className="protocol-item">
          <div className="protocol-icon-circle">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <h4>Verified Case Tracking</h4>
            <p>Every complaint receives an official reference code with timestamped status history and follow-up messaging.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
