import React, { useRef, useState } from 'react';
import { 
  Compass, ArrowLeft, CheckCircle2, MapPin, 
  Phone, ShieldCheck, Clock, Navigation, Check, 
  HelpCircle, MessageSquare, AlertCircle, Car, Languages
} from 'lucide-react';
import {
  newRequestId, registerIncident, SubmitError, FAILURE_MESSAGE, type Registration,
} from '@/services/emergency';
import { IncidentNotRegistered, IncidentRegistered } from './IncidentOutcome';

type AssistanceType = 'directions' | 'transportation' | 'translation' | 'safety' | 'lost_item' | 'other';
type Urgency = 'high' | 'medium' | 'standard';
const ASSISTANCE_LABEL: Record<AssistanceType, string> = {
  transportation: 'transport', directions: 'directions', translation: 'translation', safety: 'local safety',
  lost_item: 'lost belongings', other: 'general question',
};

interface LocalAssistanceViewProps {
  onBack: () => void;
  onSuccessTrack: (requestId: string) => void;
}

export const LocalAssistanceView: React.FC<LocalAssistanceViewProps> = ({
  onBack,
  onSuccessTrack,
}) => {
  const [assistanceType, setAssistanceType] = useState<AssistanceType>('transportation');
  const [location, setLocation] = useState<string>('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [description, setDescription] = useState<string>('');
  const [urgency, setUrgency] = useState<Urgency>('standard');
  const [contactNumber, setContactNumber] = useState<string>('');
  const [contactPreference, setContactPreference] = useState<'phone' | 'email' | 'whatsapp'>('whatsapp');

  // UI state
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationSuccessMsg, setLocationSuccessMsg] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestId = useRef(newRequestId());

  // Browser Geolocation
  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      setFormErrors(prev => ({ ...prev, location: 'This browser cannot share a location. Type your location instead.' }));
      return;
    }

    setIsLocating(true);
    setLocationSuccessMsg(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);
        const geoString = `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        setLocation(geoString);
        setLocationSuccessMsg('GPS coordinates captured');
        setIsLocating(false);
      },
      (error) => {
        setIsLocating(false);
        setFormErrors(prev => ({ ...prev, location: error.code === 1
          ? 'Location permission is blocked. Type your location instead.'
          : 'Your device could not find a location. Type your location instead.' }));
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!location.trim()) {
      errors.location = 'Please provide your current city or location.';
    }

    if (!description.trim()) {
      errors.description = 'Please describe the assistance you need.';
    } else if (description.trim().length < 15) {
      errors.description = 'Please provide at least 15 characters of detail.';
    }

    if (!contactNumber.trim()) {
      errors.contactNumber = 'Contact phone number is required.';
    } else if (!/^[+()\d\s.-]{7,32}$/.test(contactNumber.trim())) {
      errors.contactNumber = 'Use digits, spaces and + ( ) - only, at least 7 characters.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!validate() || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const gps = latitude !== undefined && longitude !== undefined;
      setRegistration(await registerIncident({
        category: 'assistance',
        title: `Local help: ${ASSISTANCE_LABEL[assistanceType]}`,
        description: description.trim(),
        client_request_id: requestId.current,
        ...(gps ? { latitude, longitude } : {}),
        details: {
          assistance_type: assistanceType,
          urgency,
          location_text: location.trim(),
          location_status: gps ? 'captured' : 'manual',
          contact_number: contactNumber.trim(),
          contact_preference: contactPreference,
        },
      }));
    } catch (err) {
      setSubmitError(err instanceof SubmitError ? err.message : FAILURE_MESSAGE.server);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (registration) {
    return (
      <div className="emergency-form-container">
        <IncidentRegistered registration={registration}
          locationNote={latitude === undefined ? `Not included as GPS coordinates. You typed: “${location.trim()}”.` : null}
          onTrack={() => onSuccessTrack(registration.incident.id)} onBack={onBack} />
      </div>
    );
  }

  return (
    <div className="emergency-form-container">
      {/* Top Breadcrumb Header */}
      <div className="form-header-bar">
        <button 
          type="button" 
          className="back-link-btn" 
          onClick={onBack}
          aria-label="Back to Emergency Support"
        >
          <ArrowLeft size={18} />
          <span>Back to Emergency Support</span>
        </button>

        <div className="form-header-title-row">
          <div className="header-icon-pill bg-amber-50 text-amber-600 border border-amber-200">
            <Compass size={24} />
          </div>
          <div>
            <h1 className="form-title">Local Travel Assistance</h1>
            <p className="form-subtitle">
              Record a request for local help with TravelSphere. TravelSphere responder accounts can see it; there is no guaranteed response time.
            </p>
          </div>
        </div>
      </div>

      {submitError && <IncidentNotRegistered message={submitError} onRetry={() => handleSubmit()} retrying={isSubmitting} />}

      <form onSubmit={handleSubmit} className="complaint-card-form" noValidate>
        {/* Section 1: Request Category & Urgency */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">1</span>
            <div className="section-title-content">
              <h3>Type of Local Assistance</h3>
              <p>Choose what kind of guidance or service you require</p>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="assistanceType">
                Assistance Category <span className="req">*</span>
              </label>
              <select
                id="assistanceType"
                className="select-input"
                value={assistanceType}
                onChange={(e) => setAssistanceType(e.target.value as AssistanceType)}
              >
                <option value="transportation">Transport Disruption / Stranded / Taxi Dispute</option>
                <option value="directions">Directions / Navigation / Safe Neighborhood Routing</option>
                <option value="translation">Language & Translation Support (Local Dialect)</option>
                <option value="safety">Local Safety Advisory & Curfew Verification</option>
                <option value="lost_item">Lost Personal Belongings / Luggage Tracking</option>
                <option value="other">General Destination Query</option>
              </select>
            </div>

            <div className="field-group">
              <label className="field-label">
                Urgency Level <span className="req">*</span>
              </label>
              <div className="urgency-selector-grid">
                {[
                  { value: 'high', label: 'High Priority', desc: 'Active trip in progress' },
                  { value: 'medium', label: 'Medium', desc: 'Response within 1-2 hours' },
                  { value: 'standard', label: 'Standard', desc: 'General non-critical inquiry' },
                ].map(item => (
                  <button
                    key={item.value}
                    type="button"
                    className={`urgency-chip ${urgency === item.value ? 'selected urgency-' + item.value : ''}`}
                    onClick={() => setUrgency(item.value as Urgency)}
                  >
                    <span className="urgency-title">{item.label}</span>
                    <span className="urgency-sub">{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Location */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">2</span>
            <div className="section-title-content">
              <h3>Where Are You?</h3>
              <p>Where you are, so a responder knows where you need help</p>
            </div>
          </div>

          <div className="field-group">
            <div className="flex-between items-center mb-1">
              <label className="field-label" htmlFor="location">
                City, Area or Landmark <span className="req">*</span>
              </label>
              <button
                type="button"
                className="detect-location-btn"
                onClick={handleDetectLocation}
                disabled={isLocating}
              >
                <Navigation size={14} className={isLocating ? 'animate-spin' : ''} />
                <span>{isLocating ? 'Detecting GPS...' : 'Use My GPS Location'}</span>
              </button>
            </div>

            <div className="input-with-icon-left">
              <MapPin size={18} className="input-icon" />
              <input
                id="location"
                type="text"
                className={`text-input with-icon ${formErrors.location ? 'has-error' : ''}`}
                placeholder="e.g., Near Tokyo Station, Marunouchi exit or Hotel lobby"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  if (formErrors.location) setFormErrors(prev => ({ ...prev, location: '' }));
                }}
              />
            </div>
            {locationSuccessMsg && (
              <span className="field-success-hint flex items-center gap-1 mt-1 text-emerald-600 text-xs">
                <Check size={14} /> {locationSuccessMsg}
              </span>
            )}
            {formErrors.location && (
              <span className="field-error-msg">{formErrors.location}</span>
            )}
          </div>

          <div className="field-group mt-4">
            <label className="field-label" htmlFor="description">
              Describe What You Need <span className="req">*</span>
            </label>
            <textarea
              id="description"
              rows={4}
              className={`textarea-input ${formErrors.description ? 'has-error' : ''}`}
              placeholder="Provide context, names of transport stations or what specific assistance would solve your issue..."
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (formErrors.description) setFormErrors(prev => ({ ...prev, description: '' }));
              }}
            />
            {formErrors.description && (
              <span className="field-error-msg">{formErrors.description}</span>
            )}
          </div>
        </div>

        {/* Section 3: Contact */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">3</span>
            <div className="section-title-content">
              <h3>Contact Information</h3>
              <p>How a TravelSphere responder can reach you</p>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="contactNumber">
                Phone Number / WhatsApp <span className="req">*</span>
              </label>
              <div className="input-with-icon-left">
                <Phone size={18} className="input-icon" />
                <input
                  id="contactNumber"
                  type="tel"
                  className={`text-input with-icon ${formErrors.contactNumber ? 'has-error' : ''}`}
                  value={contactNumber}
                  onChange={(e) => {
                    setContactNumber(e.target.value);
                    if (formErrors.contactNumber) setFormErrors(prev => ({ ...prev, contactNumber: '' }));
                  }}
                  placeholder="+1 (555) 000-0000"
                />
              </div>
              {formErrors.contactNumber && (
                <span className="field-error-msg">{formErrors.contactNumber}</span>
              )}
            </div>

            <div className="field-group">
              <label className="field-label">Preferred Response Channel</label>
              <div className="contact-pref-row">
                {(['whatsapp', 'phone', 'email'] as const).map(pref => (
                  <button
                    key={pref}
                    type="button"
                    className={`contact-chip ${contactPreference === pref ? 'selected' : ''}`}
                    onClick={() => setContactPreference(pref)}
                  >
                    <span className="capitalize">{pref}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="form-submit-row">
          <button
            type="button"
            className="btn-outline-neutral"
            onClick={onBack}
            disabled={isSubmitting}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="btn-primary-green"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="submit-spinner"></span>
                <span>Creating incident…</span>
              </>
            ) : (
              <>
                <ShieldCheck size={18} />
                <span>Register local-help request</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
