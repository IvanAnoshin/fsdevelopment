import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRealtimeURL, parseRealtimePayload } from '../src/services/realtime.js';

test('buildRealtimeURL uses events stream endpoint and realtime ticket', () => {
  assert.equal(buildRealtimeURL('https://example.com/api', 'secret-token'), 'https://example.com/api/events/stream?ticket=secret-token');
});

test('parseRealtimePayload handles json and invalid text', () => {
  assert.deepEqual(parseRealtimePayload('{"type":"message:new"}'), { type: 'message:new' });
  assert.equal(parseRealtimePayload('oops'), null);
});
