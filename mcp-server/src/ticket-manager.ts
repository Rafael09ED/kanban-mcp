import { readFileSync, writeFileSync, existsSync } from 'fs';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { 
  Ticket, 
  TicketStorage, 
  TicketCreateData, 
  TicketUpdateData, 
  ResearchTreeNode, 
  NextTicket 
} from './types.js';
import { MigrationManager } from './migrations/index.js';

export class TicketManager {
  private dataFile: string;

  constructor(dataFile: string) {
    this.dataFile = dataFile;
  }

  async initialize(): Promise<void> {
    await this.initializeDataFile();
  }

  private async initializeDataFile(): Promise<void> {
    if (!existsSync(this.dataFile)) {
      // Create new file with current version
      const initialData: TicketStorage = {
        version: '0.2.0',
        tickets: {},
        nextId: 1
      };
      writeFileSync(this.dataFile, JSON.stringify(initialData, null, 2));
    } else {
      // File exists, check if migration is needed
      const migrationManager = new MigrationManager(this.dataFile);
      await migrationManager.runMigrationIfNeeded();
    }
  }

  private readData(): TicketStorage {
    try {
      const data = readFileSync(this.dataFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to read ticket data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private writeData(data: TicketStorage): void {
    try {
      writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to write ticket data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private generateId(storage: TicketStorage): string {
    const id = `TICKET-${storage.nextId.toString().padStart(4, '0')}`;
    storage.nextId += 1;
    return id;
  }

  private validateDependencies(dependencies: string[], storage: TicketStorage, excludeId?: string): void {
    for (const depId of dependencies) {
      if (depId === excludeId) {
        throw new McpError(ErrorCode.InvalidParams, 'A ticket cannot depend on itself');
      }
      if (!storage.tickets[depId]) {
        throw new McpError(ErrorCode.InvalidParams, `Dependency ticket ${depId} does not exist`);
      }
    }
  }

  private checkCircularDependency(ticketId: string, blockedBy: string[], storage: TicketStorage): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;

      visiting.add(id);
      
      const deps = id === ticketId ? blockedBy : (storage.tickets[id]?.blockedBy || []);
      for (const depId of deps) {
        if (hasCycle(depId)) return true;
      }
      
      visiting.delete(id);
      visited.add(id);
      return false;
    };

    if (hasCycle(ticketId)) {
      throw new McpError(ErrorCode.InvalidParams, 'Circular dependency detected');
    }
  }

  createTicket(title: string, description: string, projects: string[] = [], blockedBy: string[] = []): Ticket {
    const storage = this.readData();
    
    this.validateDependencies(blockedBy, storage);
    
    const id = this.generateId(storage);
    const now = new Date().toISOString();
    
    const ticket: Ticket = {
      id,
      title,
      description,
      projects,
      blockedBy,
      createdAt: now,
      updatedAt: now,
      status: 'open'
    };

    this.checkCircularDependency(id, blockedBy, storage);
    
    storage.tickets[id] = ticket;
    this.writeData(storage);
    
    return ticket;
  }

  createTickets(tickets: TicketCreateData[]): Ticket[] {
    const storage = this.readData();
    const createdTickets: Ticket[] = [];
    const now = new Date().toISOString();

    // First pass: validate all dependencies exist
    for (const ticketData of tickets) {
      const blockedBy = ticketData.blockedBy || [];
      this.validateDependencies(blockedBy, storage);
    }

    // Second pass: create all tickets
    for (const ticketData of tickets) {
      const blockedBy = ticketData.blockedBy || [];
      const id = this.generateId(storage);
      
      const ticket: Ticket = {
        id,
        title: ticketData.title,
        description: ticketData.description,
        projects: ticketData.projects,
        blockedBy,
        createdAt: now,
        updatedAt: now,
        status: 'open'
      };

      // Check circular dependencies including newly created tickets
      this.checkCircularDependency(id, blockedBy, storage);
      
      storage.tickets[id] = ticket;
      createdTickets.push(ticket);
    }

    this.writeData(storage);
    return createdTickets;
  }

  readTicket(ticketId: string): Ticket {
    const storage = this.readData();
    const ticket = storage.tickets[ticketId];
    
    if (!ticket) {
      throw new McpError(ErrorCode.InvalidParams, `Ticket ${ticketId} not found`);
    }
    
    return ticket;
  }

  updateTickets(updates: TicketUpdateData[]): Ticket[] {
    const storage = this.readData();
    const updatedTickets: Ticket[] = [];
    
    // Validate all tickets exist first
    for (const update of updates) {
      if (!storage.tickets[update.ticketId]) {
        throw new McpError(ErrorCode.InvalidParams, `Ticket ${update.ticketId} not found`);
      }
    }
    
    // Validate dependencies and circular dependencies
    for (const update of updates) {
      if (update.blockedBy) {
        this.validateDependencies(update.blockedBy, storage, update.ticketId);
        this.checkCircularDependency(update.ticketId, update.blockedBy, storage);
      }
    }
    
    // Apply all updates
    const now = new Date().toISOString();
    for (const update of updates) {
      const { ticketId, ...updateFields } = update;
      const ticket = storage.tickets[ticketId];
      
      const updatedTicket: Ticket = {
        ...ticket,
        ...updateFields,
        updatedAt: now
      };
      
      storage.tickets[ticketId] = updatedTicket;
      updatedTickets.push(updatedTicket);
    }
    
    this.writeData(storage);
    return updatedTickets;
  }

  deleteTicket(ticketId: string): boolean {
    const storage = this.readData();
    
    if (!storage.tickets[ticketId]) {
      throw new McpError(ErrorCode.InvalidParams, `Ticket ${ticketId} not found`);
    }

    // Remove dependencies on this ticket from other tickets
    Object.values(storage.tickets).forEach(ticket => {
      ticket.blockedBy = ticket.blockedBy.filter(dep => dep !== ticketId);
    });

    delete storage.tickets[ticketId];
    this.writeData(storage);
    
    return true;
  }

  listTickets(project?: string, status?: string, dependsOn?: string): Ticket[] {
    const storage = this.readData();
    let tickets = Object.values(storage.tickets);

    if (project) {
      tickets = tickets.filter(ticket => {
        // Handle backward compatibility: check both projects array and legacy projectId
        if (ticket.projects) {
          return ticket.projects.some(p => p.toLowerCase() === project.toLowerCase());
        } else if ((ticket as any).projectId) {
          return (ticket as any).projectId.toLowerCase() === project.toLowerCase();
        }
        return false;
      });
    }

    if (status) {
      tickets = tickets.filter(ticket => ticket.status === status);
    }

    if (dependsOn) {
      tickets = tickets.filter(ticket => ticket.blockedBy.includes(dependsOn));
    }

    // Sort by creation date, newest first
    return tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  private buildResearchTree(
    ticketId: string, 
    storage: TicketStorage, 
    visitedIds: Set<string> = new Set()
  ): ResearchTreeNode[] {
    // Check if we've already processed this ticket in this path
    if (visitedIds.has(ticketId)) {
      return []; // Stop recursion to prevent loop
    }
    
    // Add current ticket to visited set for this path
    visitedIds.add(ticketId);
    
    // Find direct dependents (tickets that depend on ticketId) - exclude closed tickets
    const dependents = Object.values(storage.tickets).filter(ticket => 
      ticket.blockedBy.includes(ticketId) && ticket.status !== 'closed'
    );
    
    // Build tree nodes for each dependent
    const treeNodes = dependents.map(dependent => ({
      id: dependent.id,
      title: dependent.title,
      unblocks: this.buildResearchTree(dependent.id, storage, new Set(visitedIds))
    }));
    
    // Remove from visited set as we backtrack (for other branches)
    visitedIds.delete(ticketId);
    
    return treeNodes;
  }

  nextTickets(project?: string): NextTicket[] {
    const storage = this.readData();
    let tickets = Object.values(storage.tickets);

    // Filter to show only unblocked tickets - always exclude closed tickets
    tickets = tickets.filter(ticket => {
      // Always exclude closed tickets
      if (ticket.status === 'closed') {
        return false;
      }
      
      // No dependencies = unblocked
      if (ticket.blockedBy.length === 0) {
        return true;
      }
      
      // Check if all dependencies are closed
      return ticket.blockedBy.every((depId: string) => {
        const depTicket = storage.tickets[depId];
        return depTicket && depTicket.status === 'closed';
      });
    });

    if (project) {
      tickets = tickets.filter(ticket => {
        // Handle backward compatibility: check both projects array and legacy projectId
        if (ticket.projects) {
          return ticket.projects.some(p => p.toLowerCase() === project.toLowerCase());
        } else if ((ticket as any).projectId) {
          return (ticket as any).projectId.toLowerCase() === project.toLowerCase();
        }
        return false;
      });
    }

    // Sort by creation date, newest first
    const sortedTickets = tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // Add research tree to each ticket and exclude blockedBy field
    return sortedTickets.map(ticket => {
      const { blockedBy, ...ticketWithoutDeps } = ticket;
      return {
        ...ticketWithoutDeps,
        researchTree: this.buildResearchTree(ticket.id, storage)
      };
    });
  }
}
