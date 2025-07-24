export interface Ticket {
  id: string;
  title: string;
  description: string;
  projects: string[];
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
  status: 'open' | 'in-progress' | 'closed';
}

export interface TicketStorage {
  version: string;
  tickets: Record<string, Ticket>;
  nextId: number;
}


export interface TicketUpdateData {
  ticketId: string;
  title?: string;
  description?: string;
  blockedBy?: string[];
  status?: 'open' | 'in-progress' | 'closed';
}

export interface TicketCreateData {
  title: string;
  description: string;
  projects: string[];
  blockedBy?: string[];
}

export interface ResearchTreeNode {
  id: string;
  title: string;
  unblocks: ResearchTreeNode[];
}

export interface NextTicket extends Omit<Ticket, 'blockedBy'> {
  researchTree: ResearchTreeNode[];
}
