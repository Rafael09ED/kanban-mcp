import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChildProcess } from 'child_process';
import { McpClient } from './utils/mcp-client.js';
import { startMcpServer, stopMcpServer, cleanupTestData, getTestDataPath } from './utils/test-helpers.js';

describe('CRUD Tickets API', () => {
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

  describe('create_ticket', () => {
    it('should create a single ticket', async () => {
      const result = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Test Ticket',
          description: 'Test Description'
        }
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('Ticket created successfully');
      expect(result.content[0].text).toContain('TICKET-');
    });

    it('should create batch tickets', async () => {
      const result = await client.callTool({
        name: 'create_ticket',
        arguments: {
          tickets: [
            { title: 'Ticket 1', description: 'Description 1' },
            { title: 'Ticket 2', description: 'Description 2' }
          ]
        }
      });

      expect(result.content[0].text).toContain('2 ticket(s) created successfully');
    });

    it('should handle missing required fields', async () => {
      await expect(client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Test Ticket'
          // missing description
        }
      })).rejects.toThrow();
    });
  });

  describe('read_ticket', () => {
    it('should read an existing ticket', async () => {
      // First create a ticket
      const createResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Test Ticket',
          description: 'Test Description'
        }
      });

      const createdData = JSON.parse(createResult.content[0].text.split('\n\n')[1]);
      const ticketId = createdData.id;

      // Then read it
      const readResult = await client.callTool({
        name: 'read_ticket',
        arguments: { ticketId }
      });

      const ticket = JSON.parse(readResult.content[0].text);
      expect(ticket.id).toBe(ticketId);
      expect(ticket.title).toBe('Test Ticket');
    });

    it('should handle non-existent ticket', async () => {
      await expect(client.callTool({
        name: 'read_ticket',
        arguments: { ticketId: 'TICKET-9999' }
      })).rejects.toThrow();
    });
  });

  describe('update_ticket', () => {
    it('should update ticket fields', async () => {
      // Create ticket first
      const createResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Original Title',
          description: 'Original Description'
        }
      });

      const createdData = JSON.parse(createResult.content[0].text.split('\n\n')[1]);
      const ticketId = createdData.id;

      // Update it
      const updateResult = await client.callTool({
        name: 'update_ticket',
        arguments: {
          tickets: [{
            ticketId,
            title: 'Updated Title',
            status: 'in-progress'
          }]
        }
      });

      expect(updateResult.content[0].text).toContain('updated successfully');
      
      // Verify update
      const readResult = await client.callTool({
        name: 'read_ticket',
        arguments: { ticketId }
      });

      const ticket = JSON.parse(readResult.content[0].text);
      expect(ticket.title).toBe('Updated Title');
      expect(ticket.status).toBe('in-progress');
    });

    it('should handle invalid ticket ID', async () => {
      await expect(client.callTool({
        name: 'update_ticket',
        arguments: {
          tickets: [{
            ticketId: 'TICKET-9999',
            title: 'New Title'
          }]
        }
      })).rejects.toThrow();
    });
  });

  describe('delete_ticket', () => {
    it('should delete a ticket', async () => {
      // Create ticket first
      const createResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'To Delete',
          description: 'Will be deleted'
        }
      });

      const createdData = JSON.parse(createResult.content[0].text.split('\n\n')[1]);
      const ticketId = createdData.id;

      // Delete it
      const deleteResult = await client.callTool({
        name: 'delete_ticket',
        arguments: { ticketId }
      });

      expect(deleteResult.content[0].text).toContain('deleted successfully');

      // Verify deletion
      await expect(client.callTool({
        name: 'read_ticket',
        arguments: { ticketId }
      })).rejects.toThrow();
    });

    it('should handle non-existent ticket', async () => {
      await expect(client.callTool({
        name: 'delete_ticket',
        arguments: { ticketId: 'TICKET-9999' }
      })).rejects.toThrow();
    });
  });

  describe('list_tickets', () => {
    it('should list all tickets', async () => {
      // Create a couple tickets
      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket 1',
          description: 'Description 1',
          projects: ['project-a']
        }
      });

      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Ticket 2',
          description: 'Description 2',
          projects: ['project-b']
        }
      });

      const result = await client.callTool({
        name: 'list_tickets',
        arguments: {}
      });

      expect(result.content[0].text).toContain('Found 2 tickets');
    });

    it('should filter by project', async () => {
      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Project A Ticket',
          description: 'Description',
          projects: ['project-a']
        }
      });

      const result = await client.callTool({
        name: 'list_tickets',
        arguments: { project: 'project-a' }
      });

      expect(result.content[0].text).toContain('Found 1 tickets');
    });

    it('should filter by status', async () => {
      // Create and update ticket status
      const createResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Status Test',
          description: 'Description'
        }
      });

      const createdData = JSON.parse(createResult.content[0].text.split('\n\n')[1]);
      const ticketId = createdData.id;

      await client.callTool({
        name: 'update_ticket',
        arguments: {
          tickets: [{ ticketId, status: 'closed' }]
        }
      });

      const result = await client.callTool({
        name: 'list_tickets',
        arguments: { status: 'closed' }
      });

      expect(result.content[0].text).toContain('Found 1 tickets');
    });
  });
});
