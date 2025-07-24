#!/usr/bin/env node
import { KanbanServer } from './server.js';
import { getDataFile } from './utils.js';

// Main entry point
async function main() {
  const dataFile = getDataFile();
  const server = new KanbanServer(dataFile);
  await server.initialize();
  await server.run();
}

main().catch(console.error);
