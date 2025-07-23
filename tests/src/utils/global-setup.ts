import { cleanupAllTestData } from './test-helpers.js';

export async function setup() {
  // Clean up any existing test data files before tests start
  cleanupAllTestData();
}

export async function teardown() {
  // Clean up all test data files after tests complete
  cleanupAllTestData();
}
