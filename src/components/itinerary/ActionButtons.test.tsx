import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import ActionButtons from './ActionButtons';

describe('ActionButtons', () => {
  const mockOnChatWithAssistant = vi.fn();
  const mockOnSaveTrip = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders both action buttons', () => {
    render(
      <ActionButtons
        onChatWithAssistant={mockOnChatWithAssistant}
        onSaveTrip={mockOnSaveTrip}
      />
    );
    
    expect(screen.getByText('Ask the assistant')).toBeInTheDocument();
    expect(screen.getByText('Save itinerary')).toBeInTheDocument();
  });

  it('calls onChatWithAssistant when chat button is clicked', () => {
    render(
      <ActionButtons
        onChatWithAssistant={mockOnChatWithAssistant}
        onSaveTrip={mockOnSaveTrip}
      />
    );
    
    const chatButton = screen.getByText('Ask the assistant');
    fireEvent.click(chatButton);
    
    expect(mockOnChatWithAssistant).toHaveBeenCalledTimes(1);
  });

  it('calls onSaveTrip when save button is clicked', () => {
    render(
      <ActionButtons
        onChatWithAssistant={mockOnChatWithAssistant}
        onSaveTrip={mockOnSaveTrip}
      />
    );
    
    const saveButton = screen.getByText('Save itinerary');
    fireEvent.click(saveButton);
    
    expect(mockOnSaveTrip).toHaveBeenCalledTimes(1);
  });

  it('shows saving state when isSaving is true', () => {
    render(
      <ActionButtons
        onChatWithAssistant={mockOnChatWithAssistant}
        onSaveTrip={mockOnSaveTrip}
        isSaving={true}
      />
    );
    
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(screen.queryByText('Save itinerary')).not.toBeInTheDocument();
  });

  it('disables save button when isSaving is true', () => {
    render(
      <ActionButtons
        onChatWithAssistant={mockOnChatWithAssistant}
        onSaveTrip={mockOnSaveTrip}
        isSaving={true}
      />
    );
    
    const saveButton = screen.getByText('Saving…').closest('button');
    expect(saveButton).toBeDisabled();
  });

  it('does not call onSaveTrip when save button is disabled', () => {
    render(
      <ActionButtons
        onChatWithAssistant={mockOnChatWithAssistant}
        onSaveTrip={mockOnSaveTrip}
        isSaving={true}
      />
    );
    
    const saveButton = screen.getByText('Saving…').closest('button')!;
    fireEvent.click(saveButton);
    
    expect(mockOnSaveTrip).not.toHaveBeenCalled();
  });

  it('applies correct CSS classes', () => {
    const { container } = render(
      <ActionButtons
        onChatWithAssistant={mockOnChatWithAssistant}
        onSaveTrip={mockOnSaveTrip}
      />
    );
    
    expect(container.firstChild).toHaveClass('itinerary-actions');
    
    const chatButton = screen.getByText('Ask the assistant').closest('button');
    expect(chatButton).toHaveClass('btn', 'btn-primary');
    
    const saveButton = screen.getByText('Save itinerary').closest('button');
    expect(saveButton).toHaveClass('btn', 'btn-secondary');
  });

  it('handles default isSaving prop correctly', () => {
    render(
      <ActionButtons
        onChatWithAssistant={mockOnChatWithAssistant}
        onSaveTrip={mockOnSaveTrip}
      />
    );
    
    const saveButton = screen.getByText('Save itinerary').closest('button');
    expect(saveButton).not.toBeDisabled();
    expect(saveButton).toBeEnabled();
  });
});