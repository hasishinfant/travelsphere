import React, { useRef, useState } from 'react';
import { 
  FileText, ArrowLeft, CheckCircle2, AlertTriangle, 
  MapPin, Phone, ShieldCheck, Calendar, Clock, 
  HelpCircle, Building2, ExternalLink, AlertCircle
} from 'lucide-react';
import {
  newRequestId, registerIncident, SubmitError, FAILURE_MESSAGE, type Registration,
} from '@/services/emergency';
import { IncidentNotRegistered, IncidentRegistered } from './IncidentOutcome';

type DocumentType = 'passport' | 'visa' | 'national_id' | 'driving_license' | 'boarding_pass';
const DOCUMENT_LABEL: Record<DocumentType, string> = {
  passport: 'passport', visa: 'visa', national_id: 'national ID', driving_license: 'driving licence', boarding_pass: 'tickets',
};

interface LostPassportViewProps {
  onBack: () => void;
  onSuccessTrack: (requestId: string) => void;
}

export const LostPassportView: React.FC<LostPassportViewProps> = ({
  onBack,
  onSuccessTrack,
}) => {
  const [documentType, setDocumentType] = useState<DocumentType>('passport');
  const [issuingCountry, setIssuingCountry] = useState<string>('');
  const [incidentDate, setIncidentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [incidentLocation, setIncidentLocation] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [policeReportFiled, setPoliceReportFiled] = useState<boolean>(false);
  const [policeReportNumber, setPoliceReportNumber] = useState<string>('');
  const [upcomingDepartureDate, setUpcomingDepartureDate] = useState<string>('');
  const [contactNumber, setContactNumber] = useState<string>('');
  const [contactPreference, setContactPreference] = useState<'phone' | 'email' | 'whatsapp'>('phone');

  // UI state
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestId = useRef(newRequestId());

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!issuingCountry.trim()) {
      errors.issuingCountry = 'Please enter or select the issuing country.';
    }

    if (!incidentLocation.trim()) {
      errors.incidentLocation = 'Please specify where the document was lost or stolen.';
    }

    if (!description.trim()) {
      errors.description = 'Please provide a brief description of the incident.';
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
      setRegistration(await registerIncident({
        category: 'lost_documents',
        title: `Lost or stolen ${DOCUMENT_LABEL[documentType]}`,
        description: description.trim(),
        client_request_id: requestId.current,
        details: {
          document_type: documentType,
          issuing_country: issuingCountry.trim(),
          location_text: incidentLocation.trim(),
          location_status: 'manual',
          ...(incidentDate ? { incident_date: incidentDate } : {}),
          police_report_filed: policeReportFiled,
          ...(policeReportFiled && policeReportNumber.trim() ? { police_report_number: policeReportNumber.trim() } : {}),
          ...(upcomingDepartureDate ? { upcoming_departure_date: upcomingDepartureDate } : {}),
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
        <IncidentRegistered registration={registration} locationNote={`Not included as GPS coordinates. You wrote: “${incidentLocation.trim()}”.`}
          onTrack={() => onSuccessTrack(registration.incident.id)} onBack={onBack}>
          <div className="consular-guide-box mb-6">
            <Building2 size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="consular-guide-content text-left">
              <h4 className="text-sm font-semibold text-slate-900 mb-1">What you can do yourself now</h4>
              <ol className="text-xs text-slate-600 space-y-1.5 list-decimal pl-4">
                <li>Report the loss or theft to the local police and ask for a written report; many consulates ask for one before issuing replacement documents.</li>
                <li>Contact your country’s embassy or consulate directly. TravelSphere does not contact embassies for you.</li>
                <li>Keep copies of your passport and other ID ready if you have them.</li>
              </ol>
            </div>
          </div>
        </IncidentRegistered>
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
          <div className="header-icon-pill bg-blue-50 text-blue-600 border border-blue-200">
            <FileText size={24} />
          </div>
          <div>
            <h1 className="form-title">Lost Passport & Documents Assistance</h1>
            <p className="form-subtitle">
              Record lost or stolen documents with TravelSphere. TravelSphere does not contact embassies or the police for you.
            </p>
          </div>
        </div>
      </div>

      {/* Privacy Notice */}
      <div className="info-privacy-notice mb-6">
        <ShieldCheck size={18} className="text-blue-600 flex-shrink-0" />
        <span className="text-xs text-slate-600">
          <strong>Privacy:</strong> Don’t enter document numbers. Only you and TravelSphere responder accounts can see this report.
        </span>
      </div>

      {submitError && <IncidentNotRegistered message={submitError} onRetry={() => handleSubmit()} retrying={isSubmitting} />}

      <form onSubmit={handleSubmit} className="complaint-card-form" noValidate>
        {/* Section 1: Document Details */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">1</span>
            <div className="section-title-content">
              <h3>Document Information</h3>
              <p>Identify the missing travel credentials</p>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="documentType">
                Document Type <span className="req">*</span>
              </label>
              <select
                id="documentType"
                className="select-input"
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as DocumentType)}
              >
                <option value="passport">Passport (Primary Book)</option>
                <option value="visa">Entry Visa / Electronic Visa (e-Visa)</option>
                <option value="national_id">National ID Card / Green Card</option>
                <option value="driving_license">International Driving Permit / License</option>
                <option value="boarding_pass">Physical Tickets / Boarding Passes</option>
              </select>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="issuingCountry">
                Issuing Country / Citizenship <span className="req">*</span>
              </label>
              <input
                id="issuingCountry"
                type="text"
                className={`text-input ${formErrors.issuingCountry ? 'has-error' : ''}`}
                placeholder="e.g., United States, United Kingdom, India, Australia, Germany..."
                value={issuingCountry}
                onChange={(e) => {
                  setIssuingCountry(e.target.value);
                  if (formErrors.issuingCountry) setFormErrors(prev => ({ ...prev, issuingCountry: '' }));
                }}
              />
              {formErrors.issuingCountry && (
                <span className="field-error-msg">{formErrors.issuingCountry}</span>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Incident Details */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">2</span>
            <div className="section-title-content">
              <h3>Incident Circumstances</h3>
              <p>When and where were the documents misplaced or stolen?</p>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="incidentDate">
                Approximate Date of Loss <span className="req">*</span>
              </label>
              <div className="input-with-icon-left">
                <Calendar size={18} className="input-icon" />
                <input
                  id="incidentDate"
                  type="date"
                  className="text-input with-icon"
                  value={incidentDate}
                  onChange={(e) => setIncidentDate(e.target.value)}
                />
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="departureDate">
                Upcoming Flight / Departure Date (If applicable)
              </label>
              <div className="input-with-icon-left">
                <Calendar size={18} className="input-icon" />
                <input
                  id="departureDate"
                  type="date"
                  className="text-input with-icon"
                  value={upcomingDepartureDate}
                  onChange={(e) => setUpcomingDepartureDate(e.target.value)}
                />
              </div>
              <span className="field-hint">Useful to mention when you contact your embassy or consulate.</span>
            </div>
          </div>

          <div className="field-group mt-4">
            <label className="field-label" htmlFor="incidentLocation">
              Approximate Location / City / Airport / Venue <span className="req">*</span>
            </label>
            <div className="input-with-icon-left">
              <MapPin size={18} className="input-icon" />
              <input
                id="incidentLocation"
                type="text"
                className={`text-input with-icon ${formErrors.incidentLocation ? 'has-error' : ''}`}
                placeholder="e.g., Terminal 2, Heathrow Airport, London or taxi near Central Station"
                value={incidentLocation}
                onChange={(e) => {
                  setIncidentLocation(e.target.value);
                  if (formErrors.incidentLocation) setFormErrors(prev => ({ ...prev, incidentLocation: '' }));
                }}
              />
            </div>
            {formErrors.incidentLocation && (
              <span className="field-error-msg">{formErrors.incidentLocation}</span>
            )}
          </div>

          <div className="field-group mt-4">
            <label className="field-label" htmlFor="description">
              Description of Incident <span className="req">*</span>
            </label>
            <textarea
              id="description"
              rows={4}
              className={`textarea-input ${formErrors.description ? 'has-error' : ''}`}
              placeholder="Describe where the documents were last seen, whether personal bags or wallets were also taken, and any relevant details..."
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

        {/* Section 3: Police Report */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">3</span>
            <div className="section-title-content">
              <h3>Police Loss Report</h3>
              <p>Many consulates ask for a local police report before issuing replacement documents</p>
            </div>
          </div>

          <div className="checkbox-card-row mb-3">
            <label className="checkbox-card-label">
              <input
                type="checkbox"
                className="custom-checkbox"
                checked={policeReportFiled}
                onChange={(e) => setPoliceReportFiled(e.target.checked)}
              />
              <div className="checkbox-card-text">
                <span className="font-semibold text-slate-800 text-sm">I have already filed a police report with local authorities</span>
                <span className="text-xs text-slate-500 block">Check this box if you have a police reference number or loss slip.</span>
              </div>
            </label>
          </div>

          {policeReportFiled && (
            <div className="field-group pl-7">
              <label className="field-label" htmlFor="policeRef">
                Police Report / Case Reference Number
              </label>
              <input
                id="policeRef"
                type="text"
                className="text-input"
                placeholder="e.g., MET-POL-2026-98124"
                value={policeReportNumber}
                onChange={(e) => setPoliceReportNumber(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Section 4: Contact Details */}
        <div className="form-section">
          <div className="section-title-wrap">
            <span className="section-step-num">4</span>
            <div className="section-title-content">
              <h3>How to Reach You</h3>
              <p>How a TravelSphere responder can reach you</p>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="contactNumber">
                Contact Phone / WhatsApp <span className="req">*</span>
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
              <label className="field-label">Contact Preference</label>
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

        {/* Submit Row */}
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
                <span>Register lost-document report</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
