#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Get the data directory path relative to the build output
const DATA_FILE = join(__dirname, '../../data/tickets.json');
class TicketManager {
    dataFile;
    constructor(dataFile) {
        this.dataFile = dataFile;
        this.ensureDataFile();
    }
    ensureDataFile() {
        if (!existsSync(this.dataFile)) {
            const initialData = {
                tickets: {},
                nextId: 1
            };
            writeFileSync(this.dataFile, JSON.stringify(initialData, null, 2));
        }
    }
    readData() {
        try {
            const data = readFileSync(this.dataFile, 'utf-8');
            return JSON.parse(data);
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to read ticket data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    writeData(data) {
        try {
            writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to write ticket data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    generateId(storage) {
        const id = `TICKET-${storage.nextId.toString().padStart(4, '0')}`;
        storage.nextId += 1;
        return id;
    }
    validateDependencies(dependencies, storage, excludeId) {
        for (const depId of dependencies) {
            if (depId === excludeId) {
                throw new McpError(ErrorCode.InvalidParams, 'A ticket cannot depend on itself');
            }
            if (!storage.tickets[depId]) {
                throw new McpError(ErrorCode.InvalidParams, `Dependency ticket ${depId} does not exist`);
            }
        }
    }
    checkCircularDependency(ticketId, dependencies, storage) {
        const visited = new Set();
        const visiting = new Set();
        const hasCycle = (id) => {
            if (visiting.has(id))
                return true;
            if (visited.has(id))
                return false;
            visiting.add(id);
            const deps = id === ticketId ? dependencies : (storage.tickets[id]?.dependencies || []);
            for (const depId of deps) {
                if (hasCycle(depId))
                    return true;
            }
            visiting.delete(id);
            visited.add(id);
            return false;
        };
        if (hasCycle(ticketId)) {
            throw new McpError(ErrorCode.InvalidParams, 'Circular dependency detected');
        }
    }
    createTicket(title, description, projectId, dependencies = []) {
        const storage = this.readData();
        this.validateDependencies(dependencies, storage);
        const id = this.generateId(storage);
        const now = new Date().toISOString();
        const ticket = {
            id,
            title,
            description,
            projectId,
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
    createTickets(tickets) {
        const storage = this.readData();
        const createdTickets = [];
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
            const ticket = {
                id,
                title: ticketData.title,
                description: ticketData.description,
                projectId: ticketData.projectId,
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
    readTicket(ticketId) {
        const storage = this.readData();
        const ticket = storage.tickets[ticketId];
        if (!ticket) {
            throw new McpError(ErrorCode.InvalidParams, `Ticket ${ticketId} not found`);
        }
        return ticket;
    }
    updateTicket(ticketId, updates) {
        const storage = this.readData();
        const ticket = storage.tickets[ticketId];
        if (!ticket) {
            throw new McpError(ErrorCode.InvalidParams, `Ticket ${ticketId} not found`);
        }
        if (updates.dependencies) {
            this.validateDependencies(updates.dependencies, storage, ticketId);
            this.checkCircularDependency(ticketId, updates.dependencies, storage);
        }
        const updatedTicket = {
            ...ticket,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        storage.tickets[ticketId] = updatedTicket;
        this.writeData(storage);
        return updatedTicket;
    }
    deleteTicket(ticketId) {
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
    listTickets(projectId, status, dependsOn) {
        const storage = this.readData();
        let tickets = Object.values(storage.tickets);
        if (projectId) {
            tickets = tickets.filter(ticket => ticket.projectId === projectId);
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
}
class TaskManagerServer {
    server;
    ticketManager;
    constructor() {
        this.server = new Server({
            name: 'task-manager-mcp-server',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.ticketManager = new TicketManager(DATA_FILE);
        this.setupToolHandlers();
        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
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
                                        projectId: {
                                            type: 'string',
                                            description: 'The project ID this ticket belongs to'
                                        },
                                        dependencies: {
                                            type: 'array',
                                            items: { type: 'string' },
                                            description: 'Array of ticket IDs this ticket depends on',
                                            default: []
                                        }
                                    },
                                    required: ['title', 'description', 'projectId']
                                },
                                description: 'Array of ticket objects to create',
                                minItems: 1
                            },
                            title: {
                                type: 'string',
                                description: 'The ticket title (for single ticket creation - legacy support)'
                            },
                            description: {
                                type: 'string',
                                description: 'The ticket description (for single ticket creation - legacy support)'
                            },
                            projectId: {
                                type: 'string',
                                description: 'The project ID this ticket belongs to (for single ticket creation - legacy support)'
                            },
                            dependencies: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Array of ticket IDs this ticket depends on (for single ticket creation - legacy support)',
                                default: []
                            }
                        },
                        oneOf: [
                            {
                                required: ['tickets']
                            },
                            {
                                required: ['title', 'description', 'projectId']
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
                    description: 'Update properties of an existing ticket',
                    inputSchema: {
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
                            projectId: {
                                type: 'string',
                                description: 'Filter tickets by project ID'
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
                }
            ]
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case 'create_ticket': {
                        const args = request.params.arguments;
                        // Check if using new array format
                        if (args.tickets && Array.isArray(args.tickets)) {
                            // Validate each ticket in the array
                            for (const ticketData of args.tickets) {
                                if (!ticketData.title || !ticketData.description || !ticketData.projectId) {
                                    throw new McpError(ErrorCode.InvalidParams, 'Each ticket must have title, description, and projectId');
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
                        // Legacy single ticket format
                        else {
                            const { title, description, projectId, dependencies = [] } = args;
                            if (!title || !description || !projectId) {
                                throw new McpError(ErrorCode.InvalidParams, 'Title, description, and projectId are required');
                            }
                            const ticket = this.ticketManager.createTicket(title, description, projectId, dependencies);
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
                        const { ticketId } = request.params.arguments;
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
                        const { ticketId, ...updates } = request.params.arguments;
                        if (!ticketId) {
                            throw new McpError(ErrorCode.InvalidParams, 'ticketId is required');
                        }
                        if (Object.keys(updates).length === 0) {
                            throw new McpError(ErrorCode.InvalidParams, 'At least one field to update is required');
                        }
                        const ticket = this.ticketManager.updateTicket(ticketId, updates);
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Ticket updated successfully!\n\n${JSON.stringify(ticket, null, 2)}`
                                }
                            ]
                        };
                    }
                    case 'delete_ticket': {
                        const { ticketId } = request.params.arguments;
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
                        const { projectId, status, dependsOn } = request.params.arguments;
                        const tickets = this.ticketManager.listTickets(projectId, status, dependsOn);
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Found ${tickets.length} tickets:\n\n${JSON.stringify(tickets, null, 2)}`
                                }
                            ]
                        };
                    }
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
                }
            }
            catch (error) {
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
        console.error('Task Manager MCP server running on stdio');
    }
}
const server = new TaskManagerServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map