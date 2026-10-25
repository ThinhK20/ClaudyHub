export interface Migration {
  version: number
  sql: string
}

// Append-only. Never edit a migration that has shipped; add a new one instead.
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE codebases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_git_repo INTEGER NOT NULL DEFAULT 0,
        git_branch TEXT,
        git_head TEXT,
        last_checked_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        codebase_id TEXT REFERENCES codebases(id) ON DELETE SET NULL,
        provider TEXT,
        title TEXT NOT NULL,
        issue_url TEXT NOT NULL DEFAULT '',
        analysis TEXT NOT NULL DEFAULT '',
        coverage_note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        outcome TEXT,
        rejection_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reviewed_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        rejected_at TEXT
      );
      CREATE INDEX runs_updated ON runs(updated_at DESC);

      CREATE TABLE cases (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        case_no INTEGER,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        preconditions_json TEXT NOT NULL DEFAULT '[]',
        steps_json TEXT NOT NULL DEFAULT '[]',
        previous_behavior TEXT NOT NULL DEFAULT '',
        expected_behavior TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL,
        execution TEXT NOT NULL DEFAULT 'not-run',
        result_note TEXT NOT NULL DEFAULT '',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        executed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX cases_run ON cases(run_id, position);

      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        storage_key TEXT NOT NULL,
        uploaded_at TEXT NOT NULL
      );
      CREATE INDEX attachments_case ON attachments(case_id);

      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        thread TEXT NOT NULL,
        case_id TEXT,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        provider TEXT,
        codebase_id TEXT,
        usage_json TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX chat_thread ON chat_messages(run_id, thread, created_at);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE docs (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        section TEXT NOT NULL,
        grp TEXT NOT NULL,
        title TEXT NOT NULL,
        frontmatter_json TEXT NOT NULL,
        checks INTEGER NOT NULL,
        done INTEGER NOT NULL,
        steps INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, path)
      );

      CREATE VIRTUAL TABLE docs_fts USING fts5(
        workspace_id UNINDEXED,
        path UNINDEXED,
        title,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `
  }
]
