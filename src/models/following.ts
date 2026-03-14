export interface Following {
  url: string;
  name?: string;
  handle?: string;
  added: string;
  created_by?: 'human' | 'agent';
}
