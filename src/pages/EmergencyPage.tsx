import React, { useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  EmergencyLandingView, 
  HotelComplaintView, 
  MedicalEmergencyView, 
  LostPassportView, 
  LocalAssistanceView, 
  ComplaintHistoryView, 
  ComplaintDetailView 
} from '../components/emergency';
import { IncidentDetailView } from '../components/emergency/IncidentDetailView';
import { IncidentList } from '../components/emergency/IncidentList';
import { ResponderConsole } from '../components/emergency/ResponderConsole';

// Server incidents have UUIDs; older requests saved only in this browser have TS-… references
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import '../components/emergency/Emergency.css';

const EmergencyPage: React.FC = () => {
  const { tab, requestId } = useParams<{ tab?: string; requestId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Scroll to top on route / tab change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab, requestId, location.pathname]);

  // Handlers for navigation
  const handleSelectCategory = (category: 'medical' | 'passport' | 'hotel' | 'local') => {
    navigate(`/emergency-support/${category}`);
  };

  const handleBackToLanding = () => {
    navigate('/emergency-support');
  };

  const handleViewHistory = () => {
    navigate('/emergency-support/tickets');
  };

  const handleViewRequestDetail = (id: string) => {
    navigate(`/emergency-support/requests/${id}`);
  };

  const handleNewRequest = (category?: 'medical' | 'passport' | 'hotel' | 'local') => {
    if (category) {
      navigate(`/emergency-support/${category}`);
    } else {
      navigate('/emergency-support');
    }
  };

  const responderView = new URLSearchParams(location.search).get('view') === 'responder';

  // 1a. Server incident: /emergency-support/requests/:uuid (?view=responder for the responder controls)
  if (requestId && UUID_RE.test(requestId)) {
    return (
      <div className="emergency-page-wrapper">
        <div className="emergency-page-content page">
          <IncidentDetailView incidentId={requestId} staff={responderView}
            onBack={() => navigate(responderView ? '/emergency-support/responder' : '/emergency-support/tickets')} />
        </div>
      </div>
    );
  }

  if (tab === 'responder') {
    return (
      <div className="emergency-page-wrapper">
        <div className="emergency-page-content page">
          <ResponderConsole onBack={handleBackToLanding}
            onSelect={id => navigate(`/emergency-support/requests/${id}?view=responder`)} />
        </div>
      </div>
    );
  }

  // 1b. Request saved only on this device: /emergency-support/requests/:requestId
  if (requestId) {
    return (
      <div className="emergency-page-wrapper">
        <div className="emergency-page-content page">
          <ComplaintDetailView 
            requestId={requestId} 
            onBack={handleViewHistory} 
          />
        </div>
      </div>
    );
  }

  // 2. Specific Category / Tab Route
  if (tab === 'hotel') {
    return (
      <div className="emergency-page-wrapper">
        <div className="emergency-page-content page">
          <HotelComplaintView 
            onBack={handleBackToLanding}
            onSuccessTrack={handleViewRequestDetail}
          />
        </div>
      </div>
    );
  }

  if (tab === 'medical') {
    return (
      <div className="emergency-page-wrapper">
        <div className="emergency-page-content page">
          <MedicalEmergencyView 
            onBack={handleBackToLanding}
            onSuccessTrack={handleViewRequestDetail}
          />
        </div>
      </div>
    );
  }

  if (tab === 'passport') {
    return (
      <div className="emergency-page-wrapper">
        <div className="emergency-page-content page">
          <LostPassportView 
            onBack={handleBackToLanding}
            onSuccessTrack={handleViewRequestDetail}
          />
        </div>
      </div>
    );
  }

  if (tab === 'local') {
    return (
      <div className="emergency-page-wrapper">
        <div className="emergency-page-content page">
          <LocalAssistanceView 
            onBack={handleBackToLanding}
            onSuccessTrack={handleViewRequestDetail}
          />
        </div>
      </div>
    );
  }

  if (tab === 'tickets' || tab === 'history') {
    return (
      <div className="emergency-page-wrapper">
        <div className="emergency-page-content page">
          <section className="recent-requests-preview-section" aria-labelledby="my-incidents-title">
            <h2 id="my-incidents-title" className="preview-heading">Incidents registered with TravelSphere</h2>
            <p className="preview-subtext">Stored on TravelSphere’s server. Statuses change only when a responder changes them.</p>
            <IncidentList onSelect={handleViewRequestDetail} emptyText="You haven’t registered any incidents." />
          </section>
          <ComplaintHistoryView 
            onBack={handleBackToLanding}
            onSelectRequest={handleViewRequestDetail}
            onNewRequest={handleNewRequest}
          />
        </div>
      </div>
    );
  }

  // 3. Default: Landing View
  return (
    <div className="emergency-page-wrapper">
      <div className="emergency-page-content page">
        <EmergencyLandingView 
          onSelectCategory={handleSelectCategory}
          onViewHistory={handleViewHistory}
          onViewRequestDetail={handleViewRequestDetail}
          onOpenResponderConsole={() => navigate('/emergency-support/responder')}
        />
      </div>
    </div>
  );
};

export default EmergencyPage;