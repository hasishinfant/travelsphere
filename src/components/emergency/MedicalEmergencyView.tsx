import React, { useRef, useState } from 'react';
import { 
  HeartPulse, ArrowLeft, CheckCircle2, AlertTriangle, 
  MapPin, Phone, ShieldCheck, Clock, Check, 
  AlertCircle, Navigation, Activity, Stethoscope, Pill
} from 'lucide-react';
import {
  newRequestId, registerIncident, SubmitError, FAILURE_MESSAGE, type Registration,
} from '@/services/emergency';
import { EmergencyCallPanel } from './EmergencyCallPanel';
import { IncidentNotRegistered, IncidentRegistered } from './IncidentOutcome';

type AssistanceType = 'injury' | 'illness' | 'prescription' | 'dental' | 'hospital_referral' | 'other';
type Urgency = 'immediate' | 'within_2_hours' | 'within_24_hours';
const ASSISTANCE_LABEL: Record<AssistanceType, string> = {
  illness: 'Illness', injury: 'Injury', prescription: 'Prescription or lost medication', dental: 'Dental',
  hospital_referral: 'Hospital or specialist referral', other: 'Other medical problem',
};

interface MedicalEmergencyViewProps {
  onBack: () => void;
  onSuccessTrack: (requestId: string) => void;
}

export const MedicalEmergencyView: React.FC<MedicalEmergencyViewProps> = ({
  onBack,
  onSuccessTrack,
}) => {
  const [assistanceType, setAssistanceType] = useState<AssistanceType>('illness');
  const [description, setDescription] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [urgency, setUrgency] = useState<Urgency>('within_2_hours');
  const [contactNumber, setContactNumber] = useState<string>('');
  const [contactPreference, setContactPreference] = useState<'phone' | 'email' | 'whatsapp'>('phone');
  const [insuranceProvider, setInsuranceProvider] = useState<string>('');
  const [medicalConditionsOrAllergies, setMedicalConditionsOrAllergies] = useState<string>('');

  // UI state
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationSuccessMsg, setLocationSuccessMsg] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestId = useRef(newRequestId()); // reused by retries: the server returns the same incident, never a second one

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
        setLocationSuccessMsg('Current GPS coordinates detected successfully');
        setIsLocating(false);
      },
      (error) => {
        setIsLocating(false);
        setLocationSuccessMsg(null);
        setFormErrors(prev => ({ ...prev, location: error.code === 1
          ? 'Location permission is blocked. Type your location instead.'
          : 'Your device could not find a location. Type your location instead.' }));
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!description.trim()) {
      errors.description = 'Please describe the symptoms or medical situation.';
    } else if (description.trim().length < 15) {
      errors.description = 'Please provide at least 15 characters of detail.';
    }

    if (!location.trim()) {
      errors.location = 'Please enter your current city, address, or hotel location.';
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
    if (!validate()) return;

    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const gps = latitude !== undefined && longitude !== undefined;
      setRegistration(await registerIncident({
        category: 'medical',
        title: `Medical: ${ASSISTANCE_LABEL[assistanceType]}`,
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
          ...(insuranceProvider.trim() ? { insurance_provider: insuranceProvider.trim() } : {}),
          ...(medicalConditionsOrAllergies.trim() ? { conditions_or_allergies: medicalConditionsOrAllergies.trim() } : {}),
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
          <div className="header-icon-pill bg-rose-50 text-rose-600 border border-rose-200">
            <HeartPulse size={24} />
          </div>
          <div>
            <h1 className="form-title">Medical Assistance Request</h1>
            <p className="form-subtitle">
              Record a medical problem with TravelSphere. TravelSphere responder accounts can see it; nobody is sent to you automatically.
            </p>
          </div>
        </div>
      </div>

      {/* Critical Medical Disclaimer Banner */}
      <div className="emergency-notice-compact mb-6">
        <AlertTriangle size={20} className="notice-icon text-rose-600" />
        <div className="notice-text">
          <strong className="text-rose-900">Immediate Life-Threatening Emergency?</strong>
          <p className="text-rose-700">
            Severe injury, chest pain, difficulty breathing or loss of consciousness:
            <strong> call emergency services now.</strong> This form does not contact them.
          </p>
        </div>
      </div>
      <EmergencyCallPanel compact />

      {submitError && <IncidentNotRegistered message={submitError} onRetry={() => handleSubmit()} retrying={isSubmitting} />}

      <form onSubmit={handleSubmit} className="complaint-card-form" noValidate>
        {/* Section 1: Type & Urgency */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">1</span>
            <div className="section-title-content">
              <h3>Medical Situation & Urgency</h3>
              <p>So a responder can see what happened and how urgent it is</p>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="assistanceType">
                Assistance Needed <span className="req">*</span>
              </label>
              <select 
                id="assistanceType"
                className="select-input"
                value={assistanceType}
                onChange={(e) => setAssistanceType(e.target.value as AssistanceType)}
              >
                <option value="illness">Illness / Infection / High Fever</option>
                <option value="injury">Physical Injury / Fall / Sprain</option>
                <option value="prescription">Prescription Drug Refill / Lost Medication</option>
                <option value="dental">Emergency Dental Care</option>
                <option value="hospital_referral">Hospital / Specialist Referral</option>
                <option value="other">Other Medical Query</option>
              </select>
            </div>

            <div className="field-group">
              <label className="field-label">
                Urgency Level <span className="req">*</span>
              </label>
              <div className="urgency-selector-grid">
                {[
                  { value: 'immediate', label: 'Urgent', desc: 'Needs help ASAP' },
                  { value: 'within_2_hours', label: 'Within 2 Hours', desc: 'Same-day consultation' },
                  { value: 'within_24_hours', label: 'Standard', desc: 'Within 24 hours' },
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

          <div className="field-group mt-4">
            <label className="field-label" htmlFor="description">
              Describe Symptoms / Medical Situation <span className="req">*</span>
            </label>
            <textarea
              id="description"
              rows={4}
              className={`textarea-input ${formErrors.description ? 'has-error' : ''}`}
              placeholder="Please provide details of current symptoms, when they began, any medications taken, or assistance required..."
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

        {/* Section 2: Location & Detection */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">2</span>
            <div className="section-title-content">
              <h3>Current Location</h3>
              <p>Where you are, so a responder knows where the problem is</p>
            </div>
          </div>

          <div className="field-group">
            <div className="flex-between items-center mb-1">
              <label className="field-label" htmlFor="location">
                City, Address or Hotel Name <span className="req">*</span>
              </label>
              <button
                type="button"
                className="detect-location-btn"
                onClick={handleDetectLocation}
                disabled={isLocating}
              >
                <Navigation size={14} className={isLocating ? 'animate-spin' : ''} />
                <span>{isLocating ? 'Detecting GPS...' : 'Use My Current Location'}</span>
              </button>
            </div>

            <div className="input-with-icon-left">
              <MapPin size={18} className="input-icon" />
              <input
                id="location"
                type="text"
                className={`text-input with-icon ${formErrors.location ? 'has-error' : ''}`}
                placeholder="e.g., Room 402, The Grand Palace Hotel, Mumbai, India"
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
        </div>

        {/* Section 3: Health Profile & Insurance */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">3</span>
            <div className="section-title-content">
              <h3>Health Background & Insurance (Optional)</h3>
              <p>Optional. Visible only to you and TravelSphere responder accounts.</p>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="allergies">
                Pre-existing Conditions or Allergies
              </label>
              <input
                id="allergies"
                type="text"
                className="text-input"
                placeholder="e.g., Penicillin allergy, Asthma, Diabetes, none"
                value={medicalConditionsOrAllergies}
                onChange={(e) => setMedicalConditionsOrAllergies(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="insuranceProvider">
                Travel Health Insurance Provider
              </label>
              <input
                id="insuranceProvider"
                type="text"
                className="text-input"
                placeholder="e.g., Allianz Global, AXA, SafetyWing, etc."
                value={insuranceProvider}
                onChange={(e) => setInsuranceProvider(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Section 4: Contact Information */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">4</span>
            <div className="section-title-content">
              <h3>Emergency Contact Details</h3>
              <p>How a TravelSphere responder can reach you</p>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="contactNumber">
                Direct Contact Phone Number <span className="req">*</span>
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
              <label className="field-label">Preferred Contact Channel</label>
              <div className="contact-pref-row">
                {(['phone', 'whatsapp', 'email'] as const).map(pref => (
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

        {/* Submit Actions */}
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
                <span>Register medical request</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
