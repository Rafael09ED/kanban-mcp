import { resolve, relative, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validate and sanitize the DATA_FILE path
export function validateDataFilePath(filePath: string): string {
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

// Get the default data file path
export function getDefaultDataFile(): string {
  return join(__dirname, '../../data/tickets.json');
}

// Get the data file path from environment or use default
export function getDataFile(): string {
  const DEFAULT_DATA_FILE = getDefaultDataFile();
  return process.env.DATA_FILE 
    ? validateDataFilePath(process.env.DATA_FILE) 
    : validateDataFilePath(DEFAULT_DATA_FILE);
}
