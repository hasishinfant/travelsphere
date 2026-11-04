// Component to display fallback status to users
import React, { useState, useEffect } from 'react';
import Icon from '@/components/shared/Icon';
import { fallbackService } from '@/services/fallbackService';

interface FallbackStatusBannerProps {
  className?: string;
  showWhenOperational?: boolean;
}

const FallbackStatusBanner: React.FC<FallbackStatusBannerProps> = ({
  className = '',
  showWhenOperational = false,
}) => {
  const [status, setStatus] = useState(fallbackService.getStatus());
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const checkStatus = () => {
      const currentStatus = fallbackService.getStatus();
      setStatus(currentStatus);
      
      // Show banner if we should display status message and it hasn't been dismissed
      const shouldShow = fallbackService.shouldShowStatusMessage() && !isDismissed;
      setIsVisible(shouldShow || (showWhenOperational && !currentStatus.shouldUseFallback));
    };

    // Check status immediately
    checkStatus();

    // Set up interval to check status periodically
    const interval = setInterval(checkStatus, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [isDismissed, showWhenOperational]);

  const handleDismiss = () => {
    setIsDismissed(true);
    setIsVisible(false);
  };

  const handleRetry = async () => {
    setIsDismissed(false);
    await fallbackService.forceHealthCheck();
    const newStatus = fallbackService.getStatus();
    setStatus(newStatus);
    
    if (!fallbackService.shouldShowStatusMessage()) {
      setIsVisible(false);
    }
  };

  if (!isVisible) {
    return null;
  }

  const getStatusClass = () => {
    if (!status.shouldUseFallback) {
      return 'fallback-status operational';
    }
    
    switch (status.reason) {
      case 'offline':
        return 'fallback-status offline';
      case 'api_down':
        return 'fallback-status api-down';
      case 'timeout':
        return 'fallback-status timeout';
      default:
        return 'fallback-status error';
    }
  };

  const getStatusIcon = () => {
    if (!status.shouldUseFallback) {
      return <Icon name="success" size="sm" />;
    }
    
    switch (status.reason) {
      case 'offline':
        return <Icon name="offline" size="sm" />;
      case 'api_down':
        return <Icon name="maintenance" size="sm" />;
      case 'timeout':
        return '⏱️';
      default:
        return <Icon name="warning" size="sm" />;
    }
  };

  return (
    <div className={`${getStatusClass()} ${className}`}>
      <div className="fallback-status-content">
        <span className="fallback-status-icon" role="img" aria-label="Status">
          {getStatusIcon()}
        </span>
        <span className="fallback-status-message">
          {fallbackService.getStatusMessage()}
        </span>
      </div>
      
      <div className="fallback-status-actions">
        {status.shouldUseFallback && (
          <button 
            className="fallback-status-button retry-button"
            onClick={handleRetry}
            type="button"
          >
            Retry
          </button>
        )}
        <button 
          className="fallback-status-button dismiss-button"
          onClick={handleDismiss}
          type="button"
          aria-label="Dismiss status"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default FallbackStatusBanner;