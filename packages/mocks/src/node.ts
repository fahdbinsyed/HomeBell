/** Node/test wiring: in-memory environment without simulator. */
import { createMockEnvironment, type MockEnvironment } from './environment';
import type { MockApp } from './scenarios';

export function createTestEnvironment(
  app: MockApp = 'school',
  scenarioId?: string,
): MockEnvironment {
  const env = createMockEnvironment({ app, simulator: false });
  if (scenarioId) env.setScenario(scenarioId);
  return env;
}

export * from './index';
