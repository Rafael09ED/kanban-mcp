import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MigrationPath {
  fromVersion: string;
  toVersion: string;
  migrationFile: string;
  migrate: (dataFile: string) => void;
}

export class MigrationManager {
  private dataFile: string;
  private availableMigrations: MigrationPath[] = [];
  private currentAppVersion = '0.2.0';

  constructor(dataFile: string) {
    this.dataFile = dataFile;
  }

  async runMigrationIfNeeded(): Promise<void> {
    try {
      await this.discoverMigrations();
      
      const rawData = this.readRawData();
      const currentDataVersion = this.detectDataVersion(rawData);
      
      if (currentDataVersion === this.currentAppVersion) {
        return; // No migration needed
      }
      
      console.error(`[Migration] Data version ${currentDataVersion} detected, migrating to ${this.currentAppVersion}...`);
      
      const migrationPath = this.findMigrationPath(currentDataVersion, this.currentAppVersion);
      
      if (!migrationPath.length) {
        throw new Error(`No migration path from ${currentDataVersion} to ${this.currentAppVersion}`);
      }
      
      // Execute migrations in sequence
      for (const step of migrationPath) {
        console.error(`[Migration] Executing migration: ${step.fromVersion} -> ${step.toVersion}`);
        step.migrate(this.dataFile);
      }
      
      console.error(`[Migration] Successfully migrated from ${currentDataVersion} to ${this.currentAppVersion}`);
    } catch (error) {
      console.error(`[Migration] Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  }

  private async discoverMigrations(): Promise<void> {
    try {
      const migrationsDir = __dirname;
      const files = await readdir(migrationsDir);
      
      const migrationFiles = files.filter(file => 
        file.startsWith('v') && file.endsWith('.js') // Look for compiled JS files
      );
      
      for (const file of migrationFiles) {
        try {
          const migrationModule = await import(join(migrationsDir, file));
          if (migrationModule.migration) {
            const migration: MigrationPath = {
              fromVersion: migrationModule.migration.fromVersion,
              toVersion: migrationModule.migration.toVersion,
              migrationFile: file,
              migrate: migrationModule.migration.migrate
            };
            this.availableMigrations.push(migration);
          }
        } catch (error) {
          console.error(`[Migration] Failed to load migration file ${file}:`, error);
        }
      }
      
      console.error(`[Migration] Discovered ${this.availableMigrations.length} migration(s)`);
    } catch (error) {
      console.error(`[Migration] Failed to discover migrations:`, error);
    }
  }

  private findMigrationPath(fromVersion: string, toVersion: string): MigrationPath[] {
    // Use BFS to find shortest migration path
    const queue: { version: string; path: MigrationPath[] }[] = [
      { version: fromVersion, path: [] }
    ];
    const visited = new Set<string>([fromVersion]);
    
    while (queue.length > 0) {
      const { version: currentVersion, path } = queue.shift()!;
      
      if (currentVersion === toVersion) {
        return path; // Found the target version
      }
      
      // Find all migrations that start from current version
      const possibleMigrations = this.availableMigrations.filter(
        migration => migration.fromVersion === currentVersion
      );
      
      for (const migration of possibleMigrations) {
        if (!visited.has(migration.toVersion)) {
          visited.add(migration.toVersion);
          queue.push({
            version: migration.toVersion,
            path: [...path, migration]
          });
        }
      }
    }
    
    return []; // No path found
  }

  private detectDataVersion(rawData: any): string {
    // Strategy 1: Check version field if present
    if (rawData.version) {
      return rawData.version;
    }
    
    // Strategy 2: Structural analysis for unversioned data
    if (rawData.tickets && typeof rawData.tickets === 'object') {
      const firstTicket = Object.values(rawData.tickets)[0] as any;
      if (firstTicket) {
        // Check for dependencies field (v0.1.0)
        if ('dependencies' in firstTicket && Array.isArray(firstTicket.dependencies)) {
          return '0.1.0';
        }
        
        // Check for blockedBy field (v0.2.0)
        if ('blockedBy' in firstTicket && Array.isArray(firstTicket.blockedBy)) {
          return '0.2.0';
        }
      }
    }
    
    // Default to earliest known version if structure is unrecognizable
    return '0.1.0';
  }

  private readRawData(): any {
    try {
      const data = readFileSync(this.dataFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      throw new Error(`Failed to read raw data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
