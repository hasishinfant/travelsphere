import React from 'react';
import { MessageCircle, Bookmark, BookmarkCheck } from 'lucide-react';

interface ActionButtonsProps {
  onChatWithAssistant: () => void;
  onSaveTrip: () => void;
  isSaving?: boolean;
  isSaved?: boolean;
}

const ActionButtons: React.FC<ActionButtonsProps> = ({ onChatWithAssistant, onSaveTrip, isSaving = false, isSaved = false }) => (
  <div className="itinerary-actions">
    <button type="button" onClick={onChatWithAssistant} className="btn btn-primary">
      <MessageCircle size={16} />
      <span>Ask the assistant</span>
    </button>
    <button type="button" onClick={onSaveTrip} disabled={isSaving || isSaved} className="btn btn-secondary">
      {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
      <span>{isSaving ? 'Saving…' : isSaved ? 'Saved' : 'Save itinerary'}</span>
    </button>
  </div>
);

export default ActionButtons;
