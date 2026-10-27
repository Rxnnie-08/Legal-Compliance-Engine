export type Role = 'admin' | 'reviewer' | 'client';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IssueKind = 'missing' | 'non_standard' | 'restricted_present';
export type IssueStatus = 'open' | 'resolved' | 'dismissed';

export interface SessionUser {
  userId: number;
  fullName: string;
  email: string;
  role: Role;
}

export interface CaseSummary {
  case_id: number;
  case_number: string;
  title: string;
  status: string;
  created_at: string;
  client_id: number;
  created_by: number;
  client_name: string;
  document_count: number;
  avg_score: number | null;
  open_issues: number;
}

export interface DocumentOverview {
  document_id: number;
  title: string;
  status: string;
  compliance_score: number | null;
  uploaded_at: string;
  case_id: number;
  case_number: string;
  case_title: string;
  client_id: number;
  uploaded_by_name: string;
  open_issues: number;
  critical_open: number;
  high_open: number;
  medium_open: number;
  low_open: number;
}

export interface ClauseRow {
  clause_id: number;
  position: number;
  heading: string | null;
  body: string;
}

export interface IssueRow {
  issue_id: number;
  document_id: number;
  rule_id: number;
  rule_code: string;
  rule_title: string;
  rule_description: string;
  rule_type: 'required' | 'restricted';
  clause_id: number | null;
  clause_position: number | null;
  clause_body: string | null;
  kind: IssueKind;
  severity: Severity;
  similarity: number;
  explanation: string | null;
  explained_at: string | null;
  status: IssueStatus;
  resolved_by_name: string | null;
  resolved_at: string | null;
}

export interface ScanResultRow {
  rule_id: number;
  rule_code: string;
  rule_title: string;
  rule_type: 'required' | 'restricted';
  severity: Severity;
  present_threshold: number;
  standard_threshold: number;
  best_similarity: number;
  best_clause_id: number | null;
  best_clause_position: number | null;
  best_ref_label: string | null;
}

export interface RuleRow {
  rule_id: number;
  rule_code: string;
  title: string;
  description: string;
  rule_type: 'required' | 'restricted';
  severity: Severity;
  present_threshold: number;
  standard_threshold: number;
  is_active: boolean;
}

export interface ReferenceClause {
  ref_id: number;
  rule_id: number;
  label: string;
  clause_text: string;
}

export interface SearchHit {
  clause_id: number;
  document_id: number;
  document_title: string;
  case_id: number;
  case_number: string;
  position: number;
  heading: string | null;
  snippet: string;
  keyword_rank: number | null;
  vector_score: number | null;
  fused_score: number;
}
