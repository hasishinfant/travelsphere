import React, { useState, useRef, useEffect } from 'react';
import { Phone, X, AlertTriangle, CheckCircle2, Loader2, MapPin } from 'lucide-react';

interface SOSButtonProps {
  className?: string;
}

type SOSStep = 'idle' | 'phone-entry' | 'confirm' | 'sending' | 'sent';

export const SOSButton: React.FC<SOSButtonProps> = ({ className = '' }) => {
  const [step, setStep] = useState<SOSStep>('idle');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'fetching' | 'done' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step === 'phone-entry') {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [step]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'sending' && step !== 'sent') handleClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step]);

  useEffect(() => {
    if (step === 'idle') return;
    const handleOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node) && step !== 'sending') {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [step]);

  const handleClose = () => {
    if (step === 'sending') return;
    setStep('idle');
    setPhoneNumber('');
    setPhoneError('');
    setLocation(null);
    setLocationStatus('idle');
  };

  const validatePhone = (num: string) => num.replace(/\D/g, '').length >= 7;

  const handleSOSClick = () => {
    setStep('phone-entry');
    if (navigator.geolocation) {
      setLocationStatus('fetching');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocationStatus('done');
        },
        () => setLocationStatus('error'),
        { timeout: 8000 }
      );
    } else {
      setLocationStatus('error');
    }
  };

  const handlePhoneSubmit = () => {
    if (!validatePhone(phoneNumber)) {
      setPhoneError('Please enter a valid phone number (at least 7 digits).');
      return;
    }
    setPhoneError('');
    setStep('confirm');
  };

  const buildSMSBody = () => {
    const timestamp = new Date().toLocaleString();
    const locationText = location
      ? `https://maps.google.com/?q=${location.lat},${location.lng}`
      : 'Unavailable';
    return encodeURIComponent(
      `🚨 SOS EMERGENCY ALERT 🚨\n\nI need immediate help! This is an urgent SOS triggered via TBO Travel App.\n\n📍 Location: ${locationText}\n🕐 Time: ${timestamp}\n\nPlease contact me or send help immediately.`
    );
  };

  const handleSendSOS = async () => {
    setStep('sending');
    await new Promise((r) => setTimeout(r, 1200));
    const cleanPhone = phoneNumber.replace(/\s/g, '');
    window.location.href = `sms:${cleanPhone}?body=${buildSMSBody()}`;
    setTimeout(() => setStep('sent'), 600);
  };

  const locationLabel =
    locationStatus === 'fetching'
      ? 'Fetching your GPS location…'
      : location
      ? `📍 ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
      : 'Location not available';

  return (
    <>
      <button
        className={`sos-trigger-btn ${className}`}
        onClick={handleSOSClick}
        aria-label="Send SOS Emergency Alert"
        type="button"
      >
        <span className="sos-pulse-ring" aria-hidden="true" />
        <span className="sos-btn-inner">
          <AlertTriangle size={22} strokeWidth={2.5} />
          <span>SOS</span>
        </span>
      </button>

      {step !== 'idle' && (
        <div className="sos-modal-overlay" role="dialog" aria-modal="true" aria-label="SOS Emergency Alert">
          <div className="sos-modal-card" ref={modalRef}>
            {step !== 'sending' && step !== 'sent' && (
              <button className="sos-modal-close" onClick={handleClose} aria-label="Close SOS dialog">
                <X size={18} />
              </button>
            )}

            {step === 'phone-entry' && (
              <>
                <div className="sos-modal-icon-wrap sos-icon-danger">
                  <AlertTriangle size={28} strokeWidth={2.5} />
                </div>
                <h2 className="sos-modal-title">Send SOS Alert</h2>
                <p className="sos-modal-desc">
                  Enter a trusted contact's phone number. We'll open your messaging app with a pre-filled emergency message including your location.
                </p>
                <div className="sos-location-row">
                  <MapPin size={14} />
                  <span>{locationLabel}</span>
                </div>
                <label htmlFor="sos-phone-input" className="sos-input-label">
                  Emergency Contact Number
                </label>
                <div className="sos-input-wrapper">
                  <Phone size={16} className="sos-input-icon" />
                  <input
                    id="sos-phone-input"
                    ref={inputRef}
                    type="tel"
                    className={`sos-phone-input ${phoneError ? 'input-error' : ''}`}
                    placeholder="+91 98765 43210"
                    value={phoneNumber}
                    onChange={(e) => { setPhoneNumber(e.target.value); if (phoneError) setPhoneError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handlePhoneSubmit()}
                    maxLength={20}
                    autoComplete="tel"
                  />
                </div>
                {phoneError && <p className="sos-field-error">{phoneError}</p>}
                <button className="sos-primary-btn" onClick={handlePhoneSubmit}>
                  <AlertTriangle size={16} /> Continue to Send SOS
                </button>
                <button className="sos-cancel-btn" onClick={handleClose}>Cancel</button>
              </>
            )}

            {step === 'confirm' && (
              <>
                <div className="sos-modal-icon-wrap sos-icon-warning">
                  <AlertTriangle size={28} strokeWidth={2.5} />
                </div>
                <h2 className="sos-modal-title">Confirm SOS Alert</h2>
                <p className="sos-modal-desc">
                  This will open your messaging app with an <strong>emergency SOS message</strong> pre-filled for:
                </p>
                <div className="sos-confirm-phone-box">
                  <Phone size={18} />
                  <span>{phoneNumber}</span>
                </div>
                <div className="sos-confirm-preview">
                  <p className="sos-preview-label">Message preview:</p>
                  <p className="sos-preview-text">
                    🚨 SOS EMERGENCY ALERT 🚨 — I need immediate help! This is an urgent SOS via TBO Travel App.
                    {location ? ` 📍 GPS coordinates attached.` : ''} Please contact me or send help immediately.
                  </p>
                </div>
                <button className="sos-primary-btn sos-btn-pulse" onClick={handleSendSOS}>
                  <Phone size={16} /> Send Emergency Message
                </button>
                <button className="sos-cancel-btn" onClick={() => setStep('phone-entry')}>
                  ← Change Number
                </button>
              </>
            )}

            {step === 'sending' && (
              <>
                <div className="sos-modal-icon-wrap sos-icon-warning">
                  <Loader2 size={30} className="sos-spinner" />
                </div>
                <h2 className="sos-modal-title">Sending SOS…</h2>
                <p className="sos-modal-desc">Opening your messaging app with the emergency alert. Please send the message when it opens.</p>
              </>
            )}

            {step === 'sent' && (
              <>
                <div className="sos-modal-icon-wrap sos-icon-success">
                  <CheckCircle2 size={30} strokeWidth={2.5} />
                </div>
                <h2 className="sos-modal-title">SOS Alert Ready!</h2>
                <p className="sos-modal-desc">
                  Your messaging app has been opened with the emergency alert pre-filled for <strong>{phoneNumber}</strong>. Tap <em>Send</em> to dispatch the alert.
                </p>
                <button className="sos-primary-btn sos-btn-success" onClick={handleClose}>
                  <CheckCircle2 size={16} /> Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default SOSButton;
