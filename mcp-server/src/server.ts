import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { TicketManager } from './ticket-manager.js';

export class KanbanServer {
  private server: Server;
  private ticketManager: TicketManager;

  constructor(dataFile: string) {
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

    this.ticketManager = new TicketManager(dataFile);
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async initialize(): Promise<void> {
    await this.ticketManager.initialize();
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
                    blockedBy: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Array of ticket IDs this ticket is blocked by',
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
              blockedBy: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of ticket IDs this ticket is blocked by (for single ticket creation)',
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
                    blockedBy: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'New array of ticket IDs this ticket is blocked by'
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
              const { title, description, projects = [], blockedBy = [] } = args;
              
              if (!title || !description) {
                throw new McpError(ErrorCode.InvalidParams, 'Title and description are required');
              }

              const ticket = this.ticketManager.createTicket(title, description, projects, blockedBy);
              
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
