import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChildProcess } from 'child_process';
import { McpClient } from './utils/mcp-client.js';
import { startMcpServer, stopMcpServer, cleanupTestData, getTestDataPath } from './utils/test-helpers.js';

describe('Basic MCP Server Tests', () => {
  let server: ChildProcess;
  let client: McpClient;
  let testDataPath: string;

  beforeEach(async () => {
    testDataPath = getTestDataPath();
    server = await startMcpServer(testDataPath);
    client = new McpClient(server);
  });

  afterEach(async () => {
    if (server) {
      await stopMcpServer(server);
    }
    cleanupTestData(testDataPath);
  });

  it('should create and read a ticket', async () => {
    // Create a ticket
    const createResult = await client.callTool({
      name: 'create_ticket',
      arguments: {
        title: 'Test Ticket',
        description: 'Basic test'
      }
    });

    expect(createResult.content).toBeDefined();
    expect(createResult.content[0].text).toContain('Ticket created successfully');
    
    const createdData = JSON.parse(createResult.content[0].text.split('\n\n')[1]);
    const ticketId = createdData.id;

    // Read the ticket
    const readResult = await client.callTool({
      name: 'read_ticket',
      arguments: { ticketId }
    });

    const ticket = JSON.parse(readResult.content[0].text);
    expect(ticket.id).toBe(ticketId);
    expect(ticket.title).toBe('Test Ticket');
    expect(ticket.description).toBe('Basic test');
  });

  it('should list tickets', async () => {
    // Create a ticket first
    await client.callTool({
      name: 'create_ticket',
      arguments: {
        title: 'List Test',
        description: 'For testing list functionality'
      }
    });

    // List tickets
    const result = await client.callTool({
      name: 'list_tickets',
      arguments: {}
    });

    expect(result.content[0].text).toContain('Found 1 tickets');
  });
});
