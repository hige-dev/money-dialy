// Email mapping types for frontend
export interface EmailMapping {
  id: string;
  type: string; // "subject" or "keyword"
  identifier: string; // raw subject or keyword
  payer?: string;
  category?: string;
  place?: string;
  comment?: string;
  exclude?: boolean; // true = exclude from auto registration
}

export interface EmailMappingInput {
  type: string;
  identifier: string;
  payer?: string;
  category?: string;
  place?: string;
  comment?: string;
  exclude?: boolean;
}

