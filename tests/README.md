# Kanban MCP Server Test Suite

A minimal TypeScript test suite for the Kanban MCP Server API contract testing.

## Structure

```
tests/
├── package.json              # Test dependencies
├── tsconfig.json             # TypeScript configuration
├── vitest.config.ts          # Vitest test configuration
├── src/
│   ├── crud-tickets.test.ts  # CRUD operations tests
│   ├── next-tickets.test.ts  # Next tickets functionality tests
│   └── utils/
│       ├── mcp-client.ts     # MCP client helper
│       └── test-helpers.ts   # Test utilities
```

## Setup

1. Install dependencies:
```bash
cd tests
npm install
```

2. Build the MCP server:
```bash
cd ../mcp-server
npm run build
```

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run with UI
npm run test:ui
```

## Notes

- Tests use isolated test data files to avoid affecting production data
- Each test starts a fresh MCP server instance
- Focuses on code coverage over exhaustive behavior testing
- Minimal framework for expanding test cases later
