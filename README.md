# Kanban MCP

A Model Context Protocol (MCP) server that provides CRUD operations for task/ticket management with dependency tracking.

## Features

- **Create Tickets**: Create new tickets with title, description, project ID, and dependencies
- **Read Tickets**: Retrieve individual ticket details by ID
- **Update Tickets**: Modify ticket properties (title, description, dependencies, status)
- **Delete Tickets**: Remove tickets safely from the system
- **List Tickets**: Query tickets with filtering by project, status, or dependencies
- **Dependency Management**: Track ticket dependencies with circular dependency detection
- **Status Tracking**: Track ticket status (open, in-progress, closed)

## Project Structure

```
kanban-mcp/
├── mcp-server/           # MCP server implementation
│   ├── src/
│   │   └── index.ts      # Main server code
│   ├── build/            # Compiled JavaScript output
│   ├── package.json
│   └── tsconfig.json
├── data/                 # Persistent storage
│   └── tickets.json      # Ticket database
├── package.json          # Root package.json for monorepo
└── README.md
```

## Available MCP Tools

### create_ticket
Create one or more tickets with validation and dependency checking. Supports both single ticket creation and batch creation.

**Single Ticket Format (Legacy):**
- `title` (required): The ticket title
- `description` (required): The ticket description  
- `projectId` (required): The project ID this ticket belongs to
- `dependencies` (optional): Array of ticket IDs this ticket depends on

**Batch Creation Format:**
- `tickets` (required): Array of ticket objects to create
  - Each ticket object contains: `title`, `description`, `projectId`, `dependencies` (optional)

**Examples:**
```javascript
// Single ticket
{
  "title": "Fix login bug",
  "description": "Resolve authentication issue",
  "projectId": "web-app"
}

// Multiple tickets
{
  "tickets": [
    {
      "title": "Setup database",
      "description": "Initialize database schema",
      "projectId": "web-app"
    },
    {
      "title": "Implement auth",
      "description": "Add user authentication",
      "projectId": "web-app",
      "dependencies": ["TICKET-0001"]
    }
  ]
}
```

### read_ticket
Get details of a specific ticket by ID.

**Parameters:**
- `ticketId` (required): The ID of the ticket to retrieve

### update_ticket
Update properties of an existing ticket.

**Parameters:**
- `ticketId` (required): The ID of the ticket to update
- `title` (optional): New title for the ticket
- `description` (optional): New description for the ticket
- `dependencies` (optional): New array of ticket IDs this ticket depends on
- `status` (optional): New status ('open', 'in-progress', 'closed')

### delete_ticket
Delete a ticket from the system.

**Parameters:**
- `ticketId` (required): The ID of the ticket to delete

### list_tickets
List tickets with optional filtering.

**Parameters:**
- `projectId` (optional): Filter tickets by project ID
- `status` (optional): Filter tickets by status ('open', 'in-progress', 'closed')
- `dependsOn` (optional): Filter tickets that depend on a specific ticket ID

## Development

```bash
# Install dependencies
npm install

# Build the MCP server
npm run build

# Start development mode (watch for changes)
npm run dev
```

## Usage with Cline

The MCP server is automatically configured for use with Cline. You can now use commands like:

- "Create a ticket for implementing user authentication in the web-app project"
- "Show me all open tickets for the mobile-app project"
- "Update ticket TICKET-0001 to mark it as in-progress"
- "List all tickets that depend on TICKET-0001"

The server provides persistent storage in JSON format and includes robust validation, dependency management, and error handling.
