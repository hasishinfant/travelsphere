// Confirmation modal component
import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export interface ConfirmationModalProps {
  isVisible: boolean;
  message: string;
  onClose: () => void;
  contactInfo?: {
    phone: string;
    email: string;
  };
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isVisible,
  message,
  onClose,
  contactInfo,
}) => {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="confirmation-modal">
      <div className="confirmation-content">
        <div className="confirmation-icon"><CheckCircle2 size={40} strokeWidth={1.5} /></div>
        <h2>Request Submitted</h2>
        <p>{message}</p>
        
        {contactInfo && (
          <div className="emergency-contacts">
            <h3>Emergency Contacts</h3>
            <div className="contact-info">
              <p><strong>Phone:</strong> {contactInfo.phone}</p>
              <p><strong>Email:</strong> {contactInfo.email}</p>
            </div>
          </div>
        )}

        <button 
          className="close-button"
          onClick={onClose}
          aria-label="Close confirmation modal"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default ConfirmationModal;