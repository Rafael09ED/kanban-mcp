# Kanban MCP

MCP server for task/ticket management with dependency tracking.

## Install

```bash
git clone https://github.com/Rafael09ED/kanban-mcp.git
cd kanban-mcp
npm install
npm run build
```

## Setup

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "kanban-mcp": {
      "command": "node",
      "args": ["/path/to/kanban-mcp/mcp-server/build/index.js"]
    }
  }
}
```

## Features

- CRUD operations for tickets
- Dependency tracking
- Status management (open, in-progress, closed)
- Project-based filtering
- Persistent JSON storage

## Tools

### create_ticket
Create tickets individually or in batches.

Parameters:
- `title` (required): Ticket title
- `description` (required): Ticket description
- `projects` (optional): Array of project names
- `dependencies` (optional): Array of ticket IDs

Batch format:
- `tickets` (required): Array of ticket objects

### read_ticket
Get ticket details by ID.

Parameters:
- `ticketId` (required): Ticket ID

### update_ticket
Update ticket properties.

Parameters:
- `tickets` (required): Array of update objects with `ticketId` and fields to update

### delete_ticket
Delete ticket by ID.

Parameters:
- `ticketId` (required): Ticket ID

### list_tickets
List tickets with optional filters.

Parameters:
- `project` (optional): Filter by project name
- `status` (optional): Filter by status
- `dependsOn` (optional): Filter by dependency

### next_tickets
Get unblocked tickets ready for work. Shows impact cascade.

Parameters:
- `project` (optional): Filter by project name

## Development

```bash
npm run dev    # Watch mode
npm run build  # Compile
```

## License

AGPLv3
