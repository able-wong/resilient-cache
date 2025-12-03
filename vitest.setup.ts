// Vitest setup file
// Add any global test setup here

import { vi } from 'vitest';

// Mock timers setup for tests that need it
vi.useFakeTimers({ shouldAdvanceTime: true });
