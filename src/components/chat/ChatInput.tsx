import React from 'react';
import { Send } from 'lucide-react';
import './ChatInput.css';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
}

const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "Type your message...",
  maxLength = 500
}) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e as any);
    }
  };

  return (
    <form onSubmit={onSubmit} className="chat-input-form">
      <div className="chat-input-container">
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyPress}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          className="chat-input-field"
          aria-label="Message"
        />
        {maxLength && value.length > maxLength * 0.8 && (
          <span className="character-count">{value.length}/{maxLength}</span>
        )}
        <button type="submit" className="chat-send-button" disabled={!value.trim() || disabled} aria-label="Send message">
          <Send size={18} />
        </button>
      </div>
    </form>
  );
};

export default ChatInput;