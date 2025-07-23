import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChildProcess } from 'child_process';
import { McpClient } from './utils/mcp-client.js';
import { startMcpServer, stopMcpServer, cleanupTestData, getTestDataPath } from './utils/test-helpers.js';

describe('Next Tickets API', () => {
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

  describe('next_tickets', () => {
    it('should return unblocked tickets', async () => {
      // Create tickets without dependencies (unblocked)
      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Independent Ticket 1',
          description: 'No dependencies'
        }
      });

      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Independent Ticket 2',
          description: 'No dependencies'
        }
      });

      const result = await client.callTool({
        name: 'next_tickets',
        arguments: {}
      });

      expect(result.content[0].text).toContain('Found 2 next tickets');
    });

    it('should exclude blocked tickets', async () => {
      // Create a dependency ticket first
      const dependencyResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Dependency Ticket',
          description: 'Must be completed first'
        }
      });

      const dependencyData = JSON.parse(dependencyResult.content[0].text.split('\n\n')[1]);
      const dependencyId = dependencyData.id;

      // Create a blocked ticket
      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Blocked Ticket',
          description: 'Depends on other ticket',
          dependencies: [dependencyId]
        }
      });

      const result = await client.callTool({
        name: 'next_tickets',
        arguments: {}
      });

      // Should only return the dependency ticket (unblocked)
      expect(result.content[0].text).toContain('Found 1 next tickets');
      
      const tickets = JSON.parse(result.content[0].text.split('\n\n')[1]);
      expect(tickets[0].title).toBe('Dependency Ticket');
    });

    it('should include tickets with closed dependencies', async () => {
      // Create and close a dependency ticket
      const dependencyResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Completed Dependency',
          description: 'Will be closed'
        }
      });

      const dependencyData = JSON.parse(dependencyResult.content[0].text.split('\n\n')[1]);
      const dependencyId = dependencyData.id;

      // Close the dependency
      await client.callTool({
        name: 'update_ticket',
        arguments: {
          tickets: [{ ticketId: dependencyId, status: 'closed' }]
        }
      });

      // Create a ticket that depends on the closed ticket
      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Now Unblocked Ticket',
          description: 'Dependency is closed',
          dependencies: [dependencyId]
        }
      });

      const result = await client.callTool({
        name: 'next_tickets',
        arguments: {}
      });

      // Should return the now-unblocked ticket
      expect(result.content[0].text).toContain('Found 1 next tickets');
      
      const tickets = JSON.parse(result.content[0].text.split('\n\n')[1]);
      expect(tickets[0].title).toBe('Now Unblocked Ticket');
    });

    it('should filter by project', async () => {
      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Project A Task',
          description: 'For project A',
          projects: ['project-a']
        }
      });

      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Project B Task',
          description: 'For project B',
          projects: ['project-b']
        }
      });

      const result = await client.callTool({
        name: 'next_tickets',
        arguments: { project: 'project-a' }
      });

      expect(result.content[0].text).toContain('Found 1 next tickets');
      
      const tickets = JSON.parse(result.content[0].text.split('\n\n')[1]);
      expect(tickets[0].title).toBe('Project A Task');
    });

    it('should exclude closed tickets by default', async () => {
      // Create tickets with different statuses
      const openResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Open Ticket',
          description: 'Open status'
        }
      });

      const openData = JSON.parse(openResult.content[0].text.split('\n\n')[1]);
      const openId = openData.id;

      const progressResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Progress Ticket',
          description: 'In progress status'
        }
      });

      const progressData = JSON.parse(progressResult.content[0].text.split('\n\n')[1]);
      const progressId = progressData.id;

      const closedResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Closed Ticket',
          description: 'Will be closed'
        }
      });

      const closedData = JSON.parse(closedResult.content[0].text.split('\n\n')[1]);
      const closedId = closedData.id;

      // Update one to in-progress and one to closed
      await client.callTool({
        name: 'update_ticket',
        arguments: {
          tickets: [
            { ticketId: progressId, status: 'in-progress' },
            { ticketId: closedId, status: 'closed' }
          ]
        }
      });

      const result = await client.callTool({
        name: 'next_tickets',
        arguments: {}
      });

      // Should return 2 tickets (open and in-progress), but not the closed one
      expect(result.content[0].text).toContain('Found 2 next tickets');
      
      const tickets = JSON.parse(result.content[0].text.split('\n\n')[1]);
      expect(tickets).toHaveLength(2);
      
      const ticketTitles = tickets.map((t: any) => t.title);
      expect(ticketTitles).toContain('Open Ticket');
      expect(ticketTitles).toContain('Progress Ticket');
      expect(ticketTitles).not.toContain('Closed Ticket');
    });

    it('should include research trees and exclude dependencies field', async () => {
      // Create a foundation ticket
      const foundationResult = await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Foundation Task',
          description: 'Base task'
        }
      });

      const foundationData = JSON.parse(foundationResult.content[0].text.split('\n\n')[1]);
      const foundationId = foundationData.id;

      // Create tickets that depend on it
      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Dependent Task 1',
          description: 'Depends on foundation',
          dependencies: [foundationId]
        }
      });

      await client.callTool({
        name: 'create_ticket',
        arguments: {
          title: 'Dependent Task 2',
          description: 'Also depends on foundation',
          dependencies: [foundationId]
        }
      });

      const result = await client.callTool({
        name: 'next_tickets',
        arguments: {}
      });

      // Should return the foundation ticket with research tree
      expect(result.content[0].text).toContain('Found 1 next tickets');
      
      const tickets = JSON.parse(result.content[0].text.split('\n\n')[1]);
      expect(tickets[0].title).toBe('Foundation Task');
      expect(tickets[0].researchTree).toBeDefined();
      expect(tickets[0].researchTree.length).toBe(2); // Two dependent tickets
      expect(tickets[0].dependencies).toBeUndefined(); // Dependencies field should be excluded
    });
  });
});
