#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validate and sanitize the DATA_FILE path
function validateDataFilePath(filePath: string): string {
  const resolvedPath = resolve(filePath);
  
  // Ensure the path is within allowed directories (project root or its subdirectories)
  const projectRoot = resolve(__dirname, '../..');
  const relativePath = relative(projectRoot, resolvedPath);
  
  // Check for path traversal attempts
  if (relativePath.startsWith('..') || relativePath.includes('..')) {
    throw new Error(`Invalid DATA_FILE path: Path traversal not allowed. Path: ${filePath}`);
  }
  
  // Ensure it's a .json file
  if (!resolvedPath.endsWith('.json')) {
    throw new Error(`Invalid DATA_FILE path: Must be a .json file. Path: ${filePath}`);
  }
  
  return resolvedPath;
}

// Get the data directory path relative to the build output, or use environment variable for testing
const DEFAULT_DATA_FILE = join(__dirname, '../../data/tickets.json');
const DATA_FILE = process.env.DATA_FILE 
  ? validateDataFilePath(process.env.DATA_FILE) 
  : validateDataFilePath(DEFAULT_DATA_FILE);

interface Ticket {
  id: string;
  title: string;
  description: string;
  projects: string[];
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  status: 'open' | 'in-progress' | 'closed';
}

interface TicketStorage {
  tickets: Record<string, Ticket>;
  nextId: number;
}

class TicketManager {
  private dataFile: string;

  constructor(dataFile: string) {
    this.dataFile = dataFile;
    this.ensureDataFile();
  }

  private ensureDataFile(): void {
    if (!existsSync(this.dataFile)) {
      const initialData: TicketStorage = {
        tickets: {},
        nextId: 1
      };
      writeFileSync(this.dataFile, JSON.stringify(initialData, null, 2));
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

  private checkCircularDependency(ticketId: string, dependencies: string[], storage: TicketStorage): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;

      visiting.add(id);
      
      const deps = id === ticketId ? dependencies : (storage.tickets[id]?.dependencies || []);
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

  createTicket(title: string, description: string, projects: string[] = [], dependencies: string[] = []): Ticket {
    const storage = this.readData();
    
    this.validateDependencies(dependencies, storage);
    
    const id = this.generateId(storage);
    const now = new Date().toISOString();
    
    const ticket: Ticket = {
      id,
      title,
      description,
      projects,
      dependencies,
      createdAt: now,
      updatedAt: now,
      status: 'open'
    };

    this.checkCircularDependency(id, dependencies, storage);
    
    storage.tickets[id] = ticket;
    this.writeData(storage);
    
    return ticket;
  }

  createTickets(tickets: Array<{title: string, description: string, projects: string[], dependencies?: string[]}>): Ticket[] {
    const storage = this.readData();
    const createdTickets: Ticket[] = [];
    const now = new Date().toISOString();

    // First pass: validate all dependencies exist
    for (const ticketData of tickets) {
      const dependencies = ticketData.dependencies || [];
      this.validateDependencies(dependencies, storage);
    }

    // Second pass: create all tickets
    for (const ticketData of tickets) {
      const dependencies = ticketData.dependencies || [];
      const id = this.generateId(storage);
      
      const ticket: Ticket = {
        id,
        title: ticketData.title,
        description: ticketData.description,
        projects: ticketData.projects,
        dependencies,
        createdAt: now,
        updatedAt: now,
        status: 'open'
      };

      // Check circular dependencies including newly created tickets
      this.checkCircularDependency(id, dependencies, storage);
      
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

  updateTickets(updates: Array<{ticketId: string} & Partial<Pick<Ticket, 'title' | 'description' | 'dependencies' | 'status'>>>): Ticket[] {
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
      if (update.dependencies) {
        this.validateDependencies(update.dependencies, storage, update.ticketId);
        this.checkCircularDependency(update.ticketId, update.dependencies, storage);
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
      ticket.dependencies = ticket.dependencies.filter(dep => dep !== ticketId);
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
      tickets = tickets.filter(ticket => ticket.dependencies.includes(dependsOn));
    }

    // Sort by creation date, newest first
    return tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  private buildResearchTree(
    ticketId: string, 
    storage: TicketStorage, 
    visitedIds: Set<string> = new Set()
  ): Array<{id: string, title: string, unblocks: any[]}> {
    // Check if we've already processed this ticket in this path
    if (visitedIds.has(ticketId)) {
      return []; // Stop recursion to prevent loop
    }
    
    // Add current ticket to visited set for this path
    visitedIds.add(ticketId);
    
    // Find direct dependents (tickets that depend on ticketId) - exclude closed tickets
    const dependents = Object.values(storage.tickets).filter(ticket => 
      ticket.dependencies.includes(ticketId) && ticket.status !== 'closed'
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

  nextTickets(project?: string): Array<Omit<Ticket, 'dependencies'> & {researchTree: Array<{id: string, title: string, unblocks: any[]}>}> {
    const storage = this.readData();
    let tickets = Object.values(storage.tickets);

    // Filter to show only unblocked tickets - always exclude closed tickets
    tickets = tickets.filter(ticket => {
      // Always exclude closed tickets
      if (ticket.status === 'closed') {
        return false;
      }
      
      // No dependencies = unblocked
      if (ticket.dependencies.length === 0) {
        return true;
      }
      
      // Check if all dependencies are closed
      return ticket.dependencies.every(depId => {
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
    
    // Add research tree to each ticket and exclude dependencies field
    return sortedTickets.map(ticket => {
      const { dependencies, ...ticketWithoutDeps } = ticket;
      return {
        ...ticketWithoutDeps,
        researchTree: this.buildResearchTree(ticket.id, storage)
      };
    });
  }
}

class KanbanServer {
  private server: Server;
  private ticketManager: TicketManager;

  constructor() {
    this.server = new Server(
      {
        name: 'kanban-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.ticketManager = new TicketManager(DATA_FILE);
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_ticket',
          description: 'Create one or more tickets. Can accept a single ticket object or an array of ticket objects for batch creation.',
          inputSchema: {
            type: 'object',
            properties: {
              tickets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: {
                      type: 'string',
                      description: 'The ticket title'
                    },
                    description: {
                      type: 'string',
                      description: 'The ticket description'
                    },
                    projects: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Array of project names this ticket belongs to',
                      default: []
                    },
                    dependencies: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Array of ticket IDs this ticket depends on',
                      default: []
                    }
                  },
                  required: ['title', 'description']
                },
                description: 'Array of ticket objects to create',
                minItems: 1
              },
              title: {
                type: 'string',
                description: 'The ticket title (for single ticket creation)'
              },
              description: {
                type: 'string',
                description: 'The ticket description (for single ticket creation)'
              },
              projects: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of project names this ticket belongs to (for single ticket creation)',
                default: []
              },
              dependencies: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of ticket IDs this ticket depends on (for single ticket creation)',
                default: []
              }
            },
            oneOf: [
              {
                required: ['tickets']
              },
              {
                required: ['title', 'description']
              }
            ]
          }
        },
        {
          name: 'read_ticket',
          description: 'Get details of a specific ticket by ID',
          inputSchema: {
            type: 'object',
            properties: {
              ticketId: {
                type: 'string',
                description: 'The ID of the ticket to retrieve'
              }
            },
            required: ['ticketId']
          }
        },
        {
          name: 'update_ticket',
          description: 'Update one or more tickets using an array of ticket update objects.',
          inputSchema: {
            type: 'object',
            properties: {
              tickets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    ticketId: {
                      type: 'string',
                      description: 'The ID of the ticket to update'
                    },
                    title: {
                      type: 'string',
                      description: 'New title for the ticket'
                    },
                    description: {
                      type: 'string',
                      description: 'New description for the ticket'
                    },
                    dependencies: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'New array of ticket IDs this ticket depends on'
                    },
                    status: {
                      type: 'string',
                      enum: ['open', 'in-progress', 'closed'],
                      description: 'New status for the ticket'
                    }
                  },
                  required: ['ticketId']
                },
                minItems: 1,
                description: 'Array of ticket update objects'
              }
            },
            required: ['tickets']
          }
        },
        {
          name: 'delete_ticket',
          description: 'Delete a ticket from the system',
          inputSchema: {
            type: 'object',
            properties: {
              ticketId: {
                type: 'string',
                description: 'The ID of the ticket to delete'
              }
            },
            required: ['ticketId']
          }
        },
        {
          name: 'list_tickets',
          description: 'List tickets with optional filtering by project, status, or dependencies',
          inputSchema: {
            type: 'object',
            properties: {
              project: {
                type: 'string',
                description: 'Filter tickets by project name (case insensitive)'
              },
              status: {
                type: 'string',
                enum: ['open', 'in-progress', 'closed'],
                description: 'Filter tickets by status'
              },
              dependsOn: {
                type: 'string',
                description: 'Filter tickets that depend on a specific ticket ID'
              }
            }
          }
        },
        {
          name: 'next_tickets',
          description: 'Get next tickets to work on - shows only unblocked tickets (tickets with no dependencies or all dependencies are closed). Only shows open and in-progress tickets. Each ticket includes a researchTree showing the full cascade of work that would be unlocked by completing it.',
          inputSchema: {
            type: 'object',
            properties: {
              project: {
                type: 'string',
                description: 'Filter tickets by project name (case insensitive)'
              }
            }
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'create_ticket': {
            const args = request.params.arguments as any;
            
            // Check if using new array format
            if (args.tickets && Array.isArray(args.tickets)) {
              // Validate each ticket in the array
              for (const ticketData of args.tickets) {
                if (!ticketData.title || !ticketData.description) {
                  throw new McpError(ErrorCode.InvalidParams, 'Each ticket must have title and description');
                }
              }

              const tickets = this.ticketManager.createTickets(args.tickets);
              
              return {
                content: [
                  {
                    type: 'text',
                    text: `${tickets.length} ticket(s) created successfully!\n\n${JSON.stringify(tickets, null, 2)}`
                  }
                ]
              };
            } 
            // Single ticket format
            else {
              const { title, description, projects = [], dependencies = [] } = args;
              
              if (!title || !description) {
                throw new McpError(ErrorCode.InvalidParams, 'Title and description are required');
              }

              const ticket = this.ticketManager.createTicket(title, description, projects, dependencies);
              
              return {
                content: [
                  {
                    type: 'text',
                    text: `Ticket created successfully!\n\n${JSON.stringify(ticket, null, 2)}`
                  }
                ]
              };
            }
          }

          case 'read_ticket': {
            const { ticketId } = request.params.arguments as any;
            
            if (!ticketId) {
              throw new McpError(ErrorCode.InvalidParams, 'ticketId is required');
            }

            const ticket = this.ticketManager.readTicket(ticketId);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(ticket, null, 2)
                }
              ]
            };
          }

          case 'update_ticket': {
            const args = request.params.arguments as any;
            const updates = args.tickets;
            
            if (!updates || !Array.isArray(updates) || updates.length === 0) {
              throw new McpError(ErrorCode.InvalidParams, 'tickets array is required and must not be empty');
            }

            // Validate each update has ticketId
            for (const update of updates) {
              if (!update.ticketId) {
                throw new McpError(ErrorCode.InvalidParams, 'Each update must have a ticketId');
              }
            }

            const tickets = this.ticketManager.updateTickets(updates);
            
            return {
              content: [
                {
                  type: 'text',
                  text: `${tickets.length} ticket(s) updated successfully!\n\n${JSON.stringify(tickets, null, 2)}`
                }
              ]
            };
          }

          case 'delete_ticket': {
            const { ticketId } = request.params.arguments as any;
            
            if (!ticketId) {
              throw new McpError(ErrorCode.InvalidParams, 'ticketId is required');
            }

            this.ticketManager.deleteTicket(ticketId);
            
            return {
              content: [
                {
                  type: 'text',
                  text: `Ticket ${ticketId} deleted successfully!`
                }
              ]
            };
          }

          case 'list_tickets': {
            const { project, status, dependsOn } = request.params.arguments as any;
            
            const tickets = this.ticketManager.listTickets(project, status, dependsOn);
            
            return {
              content: [
                {
                  type: 'text',
                  text: `Found ${tickets.length} tickets:\n\n${JSON.stringify(tickets, null, 2)}`
                }
              ]
            };
          }

          case 'next_tickets': {
            const { project } = request.params.arguments as any;
            
            const tickets = this.ticketManager.nextTickets(project);
            
            return {
              content: [
                {
                  type: 'text',
                  text: `Found ${tickets.length} next tickets to work on:\n\n${JSON.stringify(tickets, null, 2)}`
                }
              ]
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${error.message}`
              }
            ],
            isError: true
          };
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
          ],
          isError: true
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Kanban MCP server running on stdio');
  }
}

const server = new KanbanServer();
server.run().catch(console.error);
