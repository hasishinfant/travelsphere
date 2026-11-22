import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import PreBookStep from './PreBookStep';
import { preBookService } from '../../services/preBookService';
import { preBookResult, session } from '../../tests/hotelFixtures';

vi.mock('../../services/preBookService', () => ({ preBookService: { preBook: vi.fn() } }));
const preBook = vi.mocked(preBookService.preBook);

const renderStep = () => {
  const props = { onComplete: vi.fn(), onCancel: vi.fn() };
  render(<PreBookStep session={session()} {...props} />);
  return props;
};

beforeEach(() => { preBook.mockReset(); });

describe('PreBookStep', () => {
  it('verifies the selected offer at the price shown and continues when nothing changed', async () => {
    preBook.mockResolvedValue(preBookResult());
    const { onComplete } = renderStep();
    expect(screen.getByText(/Verifying Availability and Pricing/)).toBeInTheDocument();
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(preBookResult()));
    expect(preBook).toHaveBeenCalledWith('offer-cheap', 180.5);
  });

  it('asks the traveller to accept a higher price', async () => {
    const r = preBookResult({ currentPrice: 195, priceChanged: true, priceIncrease: 14.5 });
    preBook.mockResolvedValue(r);
    const { onComplete, onCancel } = renderStep();
    expect(await screen.findByText('Price Has Increased')).toBeInTheDocument();
    expect(screen.getByText('EUR 180.50')).toBeInTheDocument();
    expect(screen.getByText('EUR 195.00')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Accept New Price' }));
    expect(onComplete).toHaveBeenCalledWith(r);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows changed terms even when the price is the same', async () => {
    preBook.mockResolvedValue(preBookResult({ cancellationPolicyChanged: true, cancellationPolicy: 'Non-refundable', boardChanged: true }));
    renderStep();
    expect(await screen.findByText('Booking Terms Have Changed')).toBeInTheDocument();
    expect(screen.getByText('Cancellation policy is now: Non-refundable')).toBeInTheDocument();
    expect(screen.getByText('The meal plan for this room has changed.')).toBeInTheDocument();
  });

  it('sends the traveller back to results when the room is gone', async () => {
    preBook.mockResolvedValue(preBookResult({ available: false, prebookId: null }));
    const { onCancel, onComplete } = renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /return to search results/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows provider errors and retries', async () => {
    preBook.mockRejectedValueOnce(new Error('The hotel provider did not respond in time')).mockResolvedValueOnce(preBookResult());
    const { onComplete } = renderStep();
    expect(await screen.findByText('The hotel provider did not respond in time')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });
});
