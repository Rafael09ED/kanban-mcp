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
    createTicket(title, description, projects = [], dependencies = []) {
        const storage = this.readData();
        this.validateDependencies(dependencies, storage);
        const id = this.generateId(storage);
        const now = new Date().toISOString();
        const ticket = {
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
    readTicket(ticketId) {
        const storage = this.readData();
        const ticket = storage.tickets[ticketId];
        if (!ticket) {
            throw new McpError(ErrorCode.InvalidParams, `Ticket ${ticketId} not found`);
        }
        return ticket;
    }
    updateTickets(updates) {
        const storage = this.readData();
        const updatedTickets = [];
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
            const updatedTicket = {
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
    listTickets(project, status, dependsOn, unblockedOnly) {
        const storage = this.readData();
        let tickets = Object.values(storage.tickets);
        if (project) {
            tickets = tickets.filter(ticket => {
                // Handle backward compatibility: check both projects array and legacy projectId
                if (ticket.projects) {
                    return ticket.projects.some(p => p.toLowerCase() === project.toLowerCase());
                }
                else if (ticket.projectId) {
                    return ticket.projectId.toLowerCase() === project.toLowerCase();
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
        if (unblockedOnly) {
            tickets = tickets.filter(ticket => {
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
                    description: 'List tickets with optional filtering by project, status, dependencies, or unblocked status',
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
                            },
                            unblockedOnly: {
                                type: 'boolean',
                                description: 'Filter to show only tickets that are not blocked by dependencies (tickets with no dependencies or all dependencies are closed)'
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
                        const args = request.params.arguments;
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
                        const { project, status, dependsOn, unblockedOnly } = request.params.arguments;
                        const tickets = this.ticketManager.listTickets(project, status, dependsOn, unblockedOnly);
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