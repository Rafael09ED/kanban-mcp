import { readFileSync, writeFileSync } from 'fs';
import { Ticket, TicketStorage } from '../types.js';

// Legacy types specific to v0.1.0
export interface LegacyTicket_v0_1_0 {
  id: string;
  title: string;
  description: string;
  projects: string[];
  dependencies: string[];  // This becomes blockedBy in v0.2.0
  createdAt: string;
  updatedAt: string;
  status: 'open' | 'in-progress' | 'closed';
}

export interface LegacyTicketStorage_v0_1_0 {
  tickets: Record<string, LegacyTicket_v0_1_0>;
  nextId: number;
}

export function migrateFrom0_1_0To0_2_0(dataFile: string): void {
  // Create backup
  const backupFile = dataFile.replace('.json', '.0.1.0.json');
  const originalData = readFileSync(dataFile, 'utf-8');
  writeFileSync(backupFile, originalData);
  console.error(`[Migration] Backup created: ${backupFile}`);

  // Read legacy data
  const legacyData: LegacyTicketStorage_v0_1_0 = JSON.parse(originalData);
  
  // Convert to new format
  const newTickets: Record<string, Ticket> = {};
  for (const [id, legacyTicket] of Object.entries(legacyData.tickets)) {
    newTickets[id] = {
      ...legacyTicket,
      blockedBy: legacyTicket.dependencies  // Rename dependencies to blockedBy
    };
    // Remove the old dependencies field
    delete (newTickets[id] as any).dependencies;
  }

  const newData: TicketStorage = {
    version: '0.2.0',
    tickets: newTickets,
    nextId: legacyData.nextId
  };

  // Write migrated data
  writeFileSync(dataFile, JSON.stringify(newData, null, 2));
}

// Migration metadata
export const migration = {
  fromVersion: '0.1.0',
  toVersion: '0.2.0',
  migrate: migrateFrom0_1_0To0_2_0
};
