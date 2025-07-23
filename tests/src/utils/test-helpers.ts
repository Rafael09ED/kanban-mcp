import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TestContext {
  mcpServer?: ChildProcess;
  testDataFile: string;
}

export function getTestDataPath(): string {
  // Create a unique test data file for each test to avoid conflicts
  const randomId = randomBytes(8).toString('hex');
  return join(__dirname, `../../../data/test-tickets-${randomId}.json`);
}

export function getMcpServerPath(): string {
  return join(__dirname, '../../../mcp-server/build/index.js');
}

export async function startMcpServer(testDataPath?: string): Promise<ChildProcess> {
  const serverPath = getMcpServerPath();
  const dataPath = testDataPath || getTestDataPath();
  
  // Initialize the test data file
  const fs = require('fs');
  const emptyData = {
    tickets: {},
    nextId: 1
  };
  fs.writeFileSync(dataPath, JSON.stringify(emptyData, null, 2));
  
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { 
      ...process.env,
      DATA_FILE: dataPath
    }
  });

  // Wait a moment for server to start
  await new Promise(resolve => setTimeout(resolve, 100));

  return server;
}

export function stopMcpServer(server: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (server.killed || !server.pid) {
      resolve();
      return;
    }

    server.on('exit', () => resolve());
    server.kill('SIGTERM');
    
    // Force kill if it doesn't exit gracefully
    setTimeout(() => {
      if (!server.killed) {
        server.kill('SIGKILL');
      }
    }, 1000);
  });
}

export function cleanupTestData(testDataPath?: string): void {
  // Clean up a specific test data file
  if (testDataPath) {
    const fs = require('fs');
    try {
      if (fs.existsSync(testDataPath)) {
        fs.unlinkSync(testDataPath);
      }
    } catch (error) {
      // Ignore cleanup errors
      console.warn(`Failed to cleanup test data file ${testDataPath}:`, error);
    }
  }
}

export function cleanupAllTestData(): void {
  // Clean up all test data files
  const fs = require('fs');
  const path = require('path');
  try {
    const dataDir = join(__dirname, '../../../data');
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      for (const file of files) {
        if (file.startsWith('test-tickets-') && file.endsWith('.json')) {
          fs.unlinkSync(path.join(dataDir, file));
        }
      }
    }
  } catch (error) {
    // Ignore cleanup errors
    console.warn('Failed to cleanup test data files:', error);
  }
}
