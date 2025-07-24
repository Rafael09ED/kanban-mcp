import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChildProcess, spawn } from 'child_process';
import { McpClient } from './utils/mcp-client.js';
import { stopMcpServer, cleanupTestData, getTestDataPath, getMcpServerPath } from './utils/test-helpers.js';
import { writeFileSync, readFileSync } from 'fs';

describe('Migration System', () => {
  let server: ChildProcess;
  let client: McpClient;
  let testDataPath: string;

  // Custom startMcpServer that doesn't overwrite existing data files
  async function startMcpServerWithExistingData(testDataPath: string): Promise<ChildProcess> {
    const serverPath = getMcpServerPath();
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { 
        ...process.env,
        DATA_FILE: testDataPath
      }
    });

    // Wait a moment for server to start
    await new Promise(resolve => setTimeout(resolve, 200));

    return server;
  }

  beforeEach(async () => {
    testDataPath = getTestDataPath();
  });

  afterEach(async () => {
    if (server) {
      await stopMcpServer(server);
    }
    cleanupTestData(testDataPath);
  });

  it('should migrate from v0.1.0 to v0.2.0 (dependencies to blockedBy)', async () => {
    // Create a legacy v0.1.0 data file
    const legacyData = {
      tickets: {
        'TICKET-0001': {
          id: 'TICKET-0001',
          title: 'Legacy Ticket',
          description: 'Has old dependencies field',
          projects: ['test-project'],
          dependencies: ['TICKET-0002'], // Old field name
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          status: 'open'
        },
        'TICKET-0002': {
          id: 'TICKET-0002',
          title: 'Dependency Ticket',
          description: 'No dependencies',
          projects: [],
          dependencies: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          status: 'closed'
        }
      },
      nextId: 3
      // Note: no version field, indicating v0.1.0
    };

    // Write legacy data file
    writeFileSync(testDataPath, JSON.stringify(legacyData, null, 2));

    // Start server (this should trigger migration)
    server = await startMcpServerWithExistingData(testDataPath);
    client = new McpClient(server);

    // Verify migration was successful by reading the migrated data
    const migratedData = JSON.parse(readFileSync(testDataPath, 'utf-8'));
    
    // Check version was updated
    expect(migratedData.version).toBe('0.2.0');
    
    // Check that dependencies field was renamed to blockedBy
    expect(migratedData.tickets['TICKET-0001'].blockedBy).toEqual(['TICKET-0002']);
    expect(migratedData.tickets['TICKET-0001'].dependencies).toBeUndefined();
    
    expect(migratedData.tickets['TICKET-0002'].blockedBy).toEqual([]);
    expect(migratedData.tickets['TICKET-0002'].dependencies).toBeUndefined();

    // Verify backup was created
    const backupPath = testDataPath.replace('.json', '.0.1.0.json');
    expect(() => readFileSync(backupPath)).not.toThrow();
    
    const backupData = JSON.parse(readFileSync(backupPath, 'utf-8'));
    expect(backupData.tickets['TICKET-0001'].dependencies).toEqual(['TICKET-0002']);

    // Test that the API works with migrated data
    const result = await client.callTool({
      name: 'list_tickets',
      arguments: {}
    });

    expect(result.content[0].text).toContain('Found 2 tickets');
    
    const tickets = JSON.parse(result.content[0].text.split('\n\n')[1]);
    expect(tickets.find((t: any) => t.id === 'TICKET-0001').blockedBy).toEqual(['TICKET-0002']);
  });

  it('should handle current version data without migration', async () => {
    // Create current v0.2.0 data file
    const currentData = {
      version: '0.2.0',
      tickets: {
        'TICKET-0001': {
          id: 'TICKET-0001',
          title: 'Current Ticket',
          description: 'Already has blockedBy field',
          projects: [],
          blockedBy: [], // Current field name
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          status: 'open'
        }
      },
      nextId: 2
    };

    // Write current data file
    writeFileSync(testDataPath, JSON.stringify(currentData, null, 2));

    // Start server (should not trigger migration)
    server = await startMcpServerWithExistingData(testDataPath);
    client = new McpClient(server);

    // Verify no migration occurred (data unchanged)
    const dataAfterStart = JSON.parse(readFileSync(testDataPath, 'utf-8'));
    expect(dataAfterStart).toEqual(currentData);

    // Verify no backup was created
    const backupPath = testDataPath.replace('.json', '.0.1.0.json');
    expect(() => readFileSync(backupPath)).toThrow();

    // Test that the API works
    const result = await client.callTool({
      name: 'list_tickets',
      arguments: {}
    });

    expect(result.content[0].text).toContain('Found 1 tickets');
  });
});
