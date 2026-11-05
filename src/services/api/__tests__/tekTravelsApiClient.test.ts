import { describe, it, expect, beforeEach } from 'vitest';
import { TekTravelsApiClient, getTekTravelsApiClient, resetApiClient } from '../tekTravelsApiClient';

describe('TekTravelsApiClient', () => {
  beforeEach(() => {
    resetApiClient();
  });

  it('instantiates client with custom configuration', () => {
    const client = new TekTravelsApiClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://test-api.example.com',
      timeout: 5000,
      retryAttempts: 3,
      retryDelay: 1000,
    });
    expect(client).toBeInstanceOf(TekTravelsApiClient);
  });

  it('manages TraceId correctly', () => {
    const client = new TekTravelsApiClient();
    client.setTraceId('test-trace-id-123');
    expect(client.getTraceId()).toBe('test-trace-id-123');

    client.clearTraceId();
    expect(client.getTraceId()).toBeNull();
  });

  it('has all required API methods', () => {
    const client = new TekTravelsApiClient();
    const requiredMethods = [
      'searchFlights',
      'repriceFlight',
      'getSeatMap',
      'sellSeats',
      'getAncillaryServices',
      'getFareRules',
      'createBooking',
      'healthCheck',
    ];

    for (const method of requiredMethods) {
      expect(typeof (client as any)[method]).toBe('function');
    }
  });

  it('adheres to the singleton pattern', () => {
    resetApiClient();
    const instance1 = getTekTravelsApiClient();
    const instance2 = getTekTravelsApiClient();
    expect(instance1).toBe(instance2);
  });
});
